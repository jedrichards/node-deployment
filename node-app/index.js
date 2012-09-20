var fs = require("fs");
var httpProxy = require("http-proxy");

var env = process.env.NODE_ENV || "development";
var port = process.env.PORT || 1337;

var options = {
    router : JSON.parse(fs.readFileSync(__dirname+"/proxytable.json"))
};

function status(req,res,next) {

    if ( req.url === "/wintermute-proxy" ) {
        res.end("ok");
    } else {
        next();
    }
}

console.log("**** Starting up in %s on port %d at %s ****",env,port,new Date().toString());
console.log("Using the following proxy rules:");
for ( var i in options.router ) { console.log("  %s => %s",i,options.router[i]); }

var server = httpProxy.createServer(options,status);

server.listen(port,function(){

    if ( env === "production" ) {

        console.log("Downgrading to run as non-root user and group 'node:node'");
        process.setgid("node");
        process.setuid("node");
    }

    console.log("Listening ...");
});