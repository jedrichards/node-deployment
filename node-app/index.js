(function () {

    "use strict";

    var fs = require("fs");
    var httpProxy = require("http-proxy");
    var util = require("util");

    var env = process.env.NODE_ENV || "development";
    var port = process.env.PORT || 1337;

    var options = {
        router : JSON.parse(fs.readFileSync(__dirname+"/proxytable.json"))
    };

    log("***** Starting up in %s on port %d with pid %d",env,port,process.pid);
    log("Using the following proxy rules:\n",options.router);

    var server = httpProxy.createServer(options,status);

    server.listen(port,function(){

        // Attempt to downgrade to the node system user. This will error in an
        // environment that doesn't have that user (i.e. development) hence the
        // try/catch blocks.

        try {
            process.setgid("node");
            process.setuid("node");
            log("Downgraded to node user.");
        } catch (error) {
            log("Unable to downgrade permissions.");
        }

        log("Listening ...");
    });

    // Upstart should politely stop the app via a SIGTERM before the SIGKILL, so
    // we listen for it here and log it just to make the logs more descriptive.

    process.on("SIGTERM",function () {

        log("Stopped.");
    });

    /**
     * Status middleware. Exposes a light-weight route for checking that the proxy
     * is still responding to requests. Used by Monit.
     */
    function status(req,res,next) {

        if ( req.url === "/ping" ) {
            res.end("ok");
        } else {
            next();
        }
    }

    /**
     * Outputs information to stdout while prefixing an ISO 8601 date.
     */
    function log(item) {

        var output = new Date().toISOString()+" "+util.format.apply(null,arguments);

        util.puts(output);
    }
})();