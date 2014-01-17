var _ = require('lodash');
var http = require('http');
var util = require('util');
var events = require('events');

var Worker = function(mixdown) {
  this.vhosts = {};
  this.mixdown = mixdown;

  this.on('request', this.handleRequest);

  // send message support.  we listen for a socket.
  process.on('message', this.handleMessage.bind(this));

  // check if the external Config is enabled and starting listening if so.
  var self = this;

  //this is a bit of a problem, it is an async function in the constructor
  //also i don't think it's necessary as mixdown will do this?
  mixdown.getExternalConfig(function(err, externalConfig) {

    if (err) {
      logger.error(err);
    }
    else if (externalConfig) {

      logger.info('External Config initialized: ' + util.inspect(externalConfig));

      externalConfig.on('update', function(services) {

        mixdown.services = services;

        serverConfig.initApps(function(err) {
          if (err) {
            logger.error('Site refresh failed: ', err);
          }
          else {
            self.reload();
            services.emit('reload', serverConfig);
          }
        });
      });
    }
  });

  process.send('ready');
};

util.inherits(Worker, events.EventEmitter);

Worker.prototype.getRouter = function(app) {
  var router = _.isFunction(app.plugins.router) ? app.plugins.router() : app.plugins.router.create();

  router.on('error', function(err, results) {
    var httpContext = results[0].httpContext || {};

    var res = httpContext.response || results[0].res,
        req = httpContext.request ||results[0].req;
    err = err || {};

    res.statusCode = 500;
    res.end(err.stack);
  });

  return router;
};

Worker.prototype.reload = function() {

  // Reset vhosts
  var vhosts = {};

  // Loop over cobrands and add all of the apps by hostnames.
  _.each(this.mixdown.apps, function(app) {

    app.plugins.init(function(err) {
      if (err) {
        logger.error(err);
      }
    }); // TODO: add error emitter.

    // map the vhost
    _.each(app.config.vhosts, function(host) {
      vhosts[host] = app;
    });

  });

  this.vhosts = vhosts;
};

Worker.prototype.handleRequest = function(req, res) {
  var app = null;
  var host = null;

  // for simple case, listen on all hosts.
  var appkeys = Object.keys(this.mixdown.apps);

  if (appkeys.length === 1) {
    app = this.mixdown.apps[appkeys[0]];
  }
  else {
    host = req.headers.host.replace(/:\d+/, '');
    app  = this.vhosts[host];
  }

  // send to router.
  if (app) {
    this.getRouter(app).dispatch(req, res);
  }
  else {
    res.statusCode = 404;
    res.end("Could not find application.  Host: " + host);
  }
};

Worker.prototype.handleMessage = function(message, socket) {
  if (message = 'socket') {
    // call the http connection parsing stuff here.
    http._connectionListener.call(this, socket);
  }
};

module.exports = Worker;