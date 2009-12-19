/* qworker.js - Richard Revis - http://theplanis.com
 * Initialises a queue worker and binds a message handler to listen to local
 * messages from the qclient controller
 * The best way to read this file is to trace actions from messageHandler
 * In normal operation a cycle of:
 * workloadManager/download work -> packetHandler/uploadResult -> workloadManager
 * will occur until a stop message is recieved
 */
function QWorker() {
    this.queueURL = '/queue/';
    // Download tracker
    this.failureCounter = 0;
    // Defaults
    this.options = {'delaybetweenrequests':'2000'};
    // Accepts and actions web worker messages
    this.messageHandler = function(message) {
        // Sample input {'type':'start','options':{'delaybetweenrequests':'5000'}}
        message = JSON.parse(message);
        switch(message.type) {
            case 'start':
                this.stopped = false;
                this.failureCounter = 0;
                postMessage('Workload manager starting');
                this.workloadManager();
                break;
            case 'stop':
                postMessage('Workload manager stopping');
                if (this.rq) {
                    // Abort an ongoing download if there is one
                    this.rq.abort();
                }
                this.stopped = true;
                break;
        }
        if (message.options) {
            this.options.delaybetweenrequests =
                message.options.delaybetweenrequests || this.options.delaybetweenrequests;
        }
    };
    // Called each time the app has nothing to do (with an appropriate delay set in opts)
    this.workloadManager = function() {
        if (this.stopped) {return false;}
        if (this.failureCounter > 5) {
            postMessage('Download failure limit reached');
        } else {
            var qw = this;
            var rq = new XMLHttpRequest();
            rq.onreadystatechange = function() {
                // Request complete
                if (rq.readyState == 4) {
                    if (rq.status == 200) {
                        // Process returned data
                        qw.packetHandler(rq.responseText);
                    } else {
                        // Request failed
                        qw.downloadFailure();
                    }
                }
            };
            rq.open("GET",this.queueURL,true);
            rq.send(null);
            this.rq = rq;
        }
    };
    this.downloadFailure = function() {
        this.failureCounter += 1;
        var qw = this;
        setTimeout("qworker.workloadManager()",this.options.delaybetweenrequests);
    };
    // Handles processing of the downloaded packet and uploading the response
    this.packetHandler = function(responseData) {
        if (this.stopped) {return false;}
        var rjs = JSON.parse(responseData);
        if (rjs.code) {
            if (rjs.code == 'retry') {
                // Server notification no data currently available for processing
                postMessage('Retry delay of ' + rjs.period + 'ms requested.');
                setTimeout("qworker.workloadManager()",parseInt(rjs.period));
            }
        } else {
            var pktid = rjs.uid;
            var fnstr = unescape(rjs.fnstr);
            var data = unescape(rjs.data);
            // Assumes we are getting the function from a safe source
            eval('var fn = ' + fnstr);
            // Execute the supplied function and set a callback that
            // uploads the result and re-runs the workload manager
            var qw = this;
            this.inprocess = function() {
                // Do the supplied function on supplied data
                var result = fn(data);
                var params = "{'pktid':'" + pktid + "','result':'" + result + "'}";
                // Upload the result
                var rq = new XMLHttpRequest();
                // This should be changed to the URL of your queue server
                rq.open('POST','/queue/',true);
                rq.setRequestHeader("Content-type", "application/json");
                rq.setRequestHeader("Content-length", params.length);
                rq.setRequestHeader("Connection", "close");
                rq.send(params);
                setTimeout("qworker.workloadManager()",this.options.delaybetweenrequests);
                qw.inprocess = null;
            };
            this.inprocess();
        }
    };
};

qworker = new QWorker();

onmessage = function(event) {
    qworker.messageHandler(event.data);
}
