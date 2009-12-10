function QManager() {
    // Object keyed by UID
    // Attribs: fn,data,{prelimResults},{preferences},[sent],lastSent,callback
    this.workRequests = {
        // Example work request that does no work and returns the final verified result to the
        // client
        '1a':{'fn':'function(d){return d;}','data':'2','callback':function(d){sys.puts(d);}}
    };
    // Object keyed by IP
    // Attribs: sent, returned, verified
    this.clientScores = {};
    // List of known-good clients (e.g. servers)
    // this.trustedClients = [];
    this.configuration = {
        'queueemptyretry':20000, // ms
        'blacklistafter':20, // failed attempts
        'maxparallel':10, // concurrent processing
        'clienttimeout':20000, // max time to wait before retrying with a new client (ms)
        'minconfirmations':2 // min number of matching results required to accept
    };
    // Accepts a request from the client and returns [code,response]
    this.requestHandler = function(clientIP) {
        if (plen(this.workRequests) != 0) {
            // returns [key,wr object]
            var wr = this.getNextWorkRequest(clientIP);
            // key is false if no work is available
            if (wr[0]) {
                var key = wr[0];
                var wr = wr[1];
                var response = '{"uid":"' + key + '",';
                response += '"fnstr":"' + escape(wr.fn) + '",';
                response += '"data":"' + escape(wr.data) + '"}';
                return [200,response];
            } else if (wr[1] == 'blacklisted') {
                // Client blacklisted
                return [404,'{"code":"abandon"}'];
            }
        }
        // No work - try later
        response = '{"code":"retry","period":"' + this.configuration.queueemptyretry + '"}';
        return [200,response];
    };
    // Pulls a work request off the queue
    this.getNextWorkRequest = function(clientIP) {
        if (!this.clientScores[clientIP]) {
            this.clientScores[clientIP] = {'sent':0,'returned':0};
        }
        var clientStats = this.clientScores[clientIP];
        if (clientStats.sent < (clientStats.returned + this.configuration.blacklistafter)) {
            // Pick work from the queue
            for (key in this.workRequests) {
                var wr = this.workRequests[key];
                var currentTime = new Date();
                if (!wr.lastSent ||
                        wr.lastSent.getTime()+this.configuration.clienttimeout < currentTime.getTime()) {
                    // Too much time has passed since a request was sent and work has not been
                    // completed so ignore the max parallel requirements for this work packet
                    var ignoreMaxParallel = true;
                }
                if (!wr.sent) {wr.sent = [];}
                if (!wr.prelimResults) {wr.prelimResults = {};}
                if (ignoreMaxParallel ||
                        (wr.sent.length < (plen(wr.prelimResults) + this.configuration.maxparallel))) {
                    // Haven't yet exceeded the number of clients we can send this packet to
                    // Check we have't sent it to this client
                    for (client in wr.sent) {
                        if (wr.sent[client] == clientIP) {
                            var sentBefore = true;
                        }
                    }
                    if (!sentBefore) {
                        clientStats.sent++;
                        wr.sent.push(clientIP);
                        wr.lastSent = currentTime;
                        // Return valid work request
                        return [key,wr];
                    }
                }
            }
        } else {
            // Client is blacklisted for too many retries
            return [false,'blacklisted'];
        }
        // Couldn't send a work request for a non-blacklist reason
        return [false,'retrylater'];
    };
    // Accepts an result upload
    this.responseHandler = function(clientIP,responseData) {
        // Parse results
        var rjs = JSON.parse(responseData);
        // ID client and result supplied, then validate
        var client = this.clientScores[clientIP];
        var wr = this.workRequests[rjs.pktid];
        var ref;
        client.returned++;
        // Check and see if we have enough results to close this work request
        if (!wr.prelimResults) { wr.prelimResults = {}; }
        var q = wr.prelimResults[rjs.result] += 1;
        // Catch first result condition
        if (isNaN(q)) { wr.prelimResults[rjs.result] = 1; }
        var r = this.checkResults(wr);
        if (r) {
            // Sufficient confirmation to close this request
            wr.callback(r);
            delete this.workRequests[rjs.pktid];
        }
        return [200,'{"code":"success"}'];
    };
    // Check if any of the supplied results have been sufficiently verified
    this.checkResults = function(wr) {
        for (r in wr.prelimResults) {
            if (wr.prelimResults[r] >= this.configuration.minconfirmations) {
                return r;
            }
        }
        return false;
    };
}

function plen(obj) {
    var i = 0;
    for (k in obj) {i++;}
    return i;
}

function sendResponse(res,response) {
    res.sendHeader(response[0],{'Content-Type':'application/xml'});
    sys.puts(response.join(': '));
    res.sendBody(response[1]);
    res.finish();
}

var sys = require('sys'), 
    http = require('http');

var qm = new QManager();

http.createServer(function (req, res) {
        var clientIP = req.headers['host'].split(':')[0];

        if (req.method == 'POST') {
            req.setBodyEncoding('utf-8');
            var body = '';
            req.addListener('body', function(chunk) {
                body += chunk;
            });
            req.addListener('complete', function() {
                var response = qm.responseHandler(clientIP,body);
                sendResponse(res,response);
            });
        } else {
            var response = qm.requestHandler(clientIP);
            sendResponse(res,response);
        }

}).listen(8011);

sys.puts('Server running at http://127.0.0.1:8011/');
