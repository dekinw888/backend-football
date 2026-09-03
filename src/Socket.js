// Central place to init/access Socket.io so any controller can broadcast
// a "something changed" event without importing server.js (avoids circular
// requires). Socket.io is free and works fine on Render's free web service.

let ioInstance = null;

function init(server, options = {}) {
  const { Server } = require('socket.io');
  ioInstance = new Server(server, {
    cors: { origin: options.corsOrigin || '*' },
    // Free-tier friendly: don't hold too many idle sockets open forever.
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  ioInstance.on('connection', (socket) => {
    // Read-only broadcast channel — clients just listen, nothing to auth here.
    socket.on('disconnect', () => {});
  });

  return ioInstance;
}

function getIO() {
  return ioInstance;
}

// Never throw if a controller calls this before init() (e.g. in tests).
function emitSafe(event, payload) {
  if (ioInstance) ioInstance.emit(event, payload || {});
}

module.exports = { init, getIO, emitSafe };