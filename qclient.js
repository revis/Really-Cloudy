/* qclient.js - Richard Revis - http://theplanis.com
 * Bootstraps a qworker to execute jobs from the queue configured in qworker.js
 * Provides .start() .stop() and .setOptions()
 */
function QClient(options) {
    this.dbg = false;
    this.messageHandler = function(message) {
        if (this.dbg) {
            console.log(message);
        }
    };
    this.start = function() {
        // Test if this client is safe to use
        try {
            this.worker = new Worker('qworker.js');
        } catch(e) {
            // Do nothing, no support (may want to call back to the server here)
        }
        if (this.worker) {
            // Set a callback for web worker messages
            var qc = this;
            this.worker.onmessage = function(event) {
                qc.messageHandler(event.data);
            };
            // Sample start message (must be a string, converted with JSON.parse)
            // {'type':'start','options':{'delaybetweenrequests':'5000'}}
            this.worker.postMessage('{"type":"start"}');
            return true;
        } else {
            return false;
        }
    };
    this.stop = function() {
        // Signal the queue manager to stop
        this.worker.postMessage('{"type","stop"}');
    };
    this.setOptions = function(options) {
        // Sample options {'delaybetweenrequests':'5000'}
        this.options = this.options || {};
        // Message sent as string for compatibility
        this.worker.postMessage('{"type":"none","options":' + JSON.stringify(options) + '}');
    };
}

qclient = new QClient();
