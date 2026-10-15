const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { registerSocketHandlers } = require('./src/socket-handlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`\u0410\u0443\u043a\u0446\u0438\u043e\u043d \u0437\u0430\u043f\u0443\u0449\u0435\u043d: http://localhost:${PORT}`);
  console.log(`=========================================`);
});
