
// Enables CORS
var enableCORS = function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*:*');
    res.header('Access-Control-Allow-Credentials', 'true');
 
    // intercept OPTIONS method
    if ('OPTIONS' == req.method) {
      res.send(200);
    }
    else {
      next();
    }
};

var express = require('express');
var app = express();
// enable CORS!
app.use(enableCORS);

var cookie = require('cookie');
var serverConfiguration = require('./server.config.js');
var storeProvider = express.session.MemoryStore;
var sessionStorage = new storeProvider();

var protocol;
var server;

if (serverConfiguration.isSecureConnection) {
    var fs = require('fs');
    protocol = require('https');
    
    
    var options = {
        key: fs.readFileSync(serverConfiguration.keyFile),
        cert: fs.readFileSync(serverConfiguration.certFile),
        requestCert: true
    };
    
    server = require('https').createServer(options, app);
    
    var httpApp = express();
    // enable CORS!
    httpApp.use(enableCORS);
    
    var httpServer = require('http').createServer(httpApp);
    var httpPort = serverConfiguration.port - 1;
    
    httpApp.get('*',function(req,res){ 
        var sslPort = req.port + 1;
        var httpHost = 'https://'+req.host + ':' + sslPort;
        res.redirect(httpHost+req.url);
    })

    httpServer.listen(httpPort);
    
} else {
    protocol = require('http');
    server = protocol.createServer(app);
}

var io = require('socket.io').listen(server);
io.set('heartbeat timeout', 99999);
io.enable('browser client etag');
io.set('log level', 1);
io.set('transports', [
  'websocket'
, 'flashsocket'
, 'htmlfile'
, 'xhr-polling'
, 'jsonp-polling'
]);
var componentManager = require('./components/component.manager.js');
componentManager.set('config', serverConfiguration);

var eventManager = require('./components/event.manager.js');
var socketPull = require('./components/socket.pull.js');
var db = require('./components/db.js');
db.init(serverConfiguration.dbOptions);

componentManager.set('db', db);
componentManager.set('sp', socketPull);
componentManager.set('io', io);
componentManager.set('eventManager', eventManager);
componentManager.set('sessionStorage', sessionStorage);

server.listen(serverConfiguration.port, serverConfiguration.host);
console.log('Listening ' + serverConfiguration.host + ':' + serverConfiguration.port);

//  accept all connections from local server
if (serverConfiguration.checkClientOrigin) {
	console.log('Set origin: ' + serverConfiguration.origin);
	io.set("origins", serverConfiguration.origin);
}

//  client
io.of('/client').authorization(function (handshakeData,accept) {

//	if (!handshakeData.headers.cookie) {
//		return accept('NO COOKIE TRANSMITTED', false);
//	}

	handshakeData.cookie = '123456789123456789'; //cookie.parse(handshakeData.headers.cookie);

	var sid = '123456789123456789'; //handshakeData.cookie[serverConfiguration.sessionVarName];
//	if (!sid) {
//		return accept('Have no session id', false);
//	}

	handshakeData.sid = sid;
	handshakeData.uid = null;

	//  create write method
	handshakeData.writeSession = function (fn) {
		sessionStorage.set(sid, handshakeData.session, function () {
			if (fn) {
				fn();
			}
		});
	};

	//  trying to get session
	sessionStorage.get(sid, function (err, session) {

		//  create session handler
		var createSession = function () {
			var sessionData = {
				sid : sid,
				cookie : handshakeData.cookie,
				user : {
					role : 'guest',
					id : null,
					isAuthenticated : false
				}
			};

			//  store session in session storage
			sessionStorage.set(sid, sessionData, function () {

				//  authenticate and authorise client
				handshakeData.session = sessionData;
				accept(null, true);
			});
		};

		//  check on errors or empty session
		if (err || !session) {
			if (!session) {

				//  create new session
				createSession();
			} else {

				//  not authorise client if errors occurred
				accept('ERROR: ' + err, false);
			}
		} else {
			if (!session) {
				createSession();
			} else {

				//  authorize client
				handshakeData.session = session;
				handshakeData.uid = session.user.id;
				accept(null, true);
			}
		}
	});

}).on('connection', function (socket) {

	//  add socket to pull
	socketPull.add(socket);

	//  connect socket to him channels
	componentManager.get('channel').attachToChannels(socket);

	//  bind events to socket
	eventManager.client.bind(socket);
});

//  server
io.of('/server').authorization(function (data, accept) {
	if (data && data.address) {
            data.sid = data.address;
            var found = false;
            for (var i in serverConfiguration.allowedServers) {
                    if (serverConfiguration.allowedServers[i] == data.address.address) {
                            found = true;
                            break;
                    }
            }
            if (found) {
                    accept(null, true);
//                    console.log('SERVER: ' + data.address.address + '');
            } else {
                    accept('INVALID SERVER: server host ' + data.address.address + ' not allowed');
            }
	} else {
            accept('NO ADDRESS TRANSMITTED.', false);
            return false;
	}
}).on('connection', function (socket) {

	//  bind events
	eventManager.server.bind(socket);
});

//  client
io.of('/mobile').authorization(function (handshakeData,accept) {

				accept(handshakeData.headers, false);


}).on('connection', function (socket) {

	//  add socket to pull
	socketPull.add(socket);

	//  connect socket to him channels
	componentManager.get('channel').attachToChannels(socket);

	//  bind events to socket
	eventManager.client.bind(socket);
});

componentManager.initCompleted();