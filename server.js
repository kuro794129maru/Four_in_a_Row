const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROWS = 6;
const COLS = 7;
const EMPTY = 0;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      board: createEmptyBoard(),
      players: [null, null],
      currentPlayer: 1,
      winner: null,
      moveCount: 0
    });
  }

  return rooms.get(roomId);
}

function getPlayerNumber(room, socketId) {
  if (room.players[0] === socketId) {
    return 1;
  }
  if (room.players[1] === socketId) {
    return 2;
  }

  return null;
}

function assignPlayerSeat(room, socketId) {
  const currentSeat = getPlayerNumber(room, socketId);
  if (currentSeat) {
    return currentSeat;
  }

  if (!room.players[0]) {
    room.players[0] = socketId;
    return 1;
  }

  if (!room.players[1]) {
    room.players[1] = socketId;
    return 2;
  }

  return null;
}

function getPlayerCount(room) {
  return room.players.filter(Boolean).length;
}

function dropPiece(board, col, player) {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row][col] === EMPTY) {
      board[row][col] = player;
      return row;
    }
  }

  return -1;
}

function checkWin(board, row, col, player) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  for (const [dr, dc] of directions) {
    let count = 1;

    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
      count += 1;
      r += dr;
      c += dc;
    }

    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
      count += 1;
      r -= dr;
      c -= dc;
    }

    if (count >= 4) {
      return true;
    }
  }

  return false;
}

io.on('connection', (socket) => {
  socket.on('join room', (rawRoomId, ack) => {
    const roomId = String(rawRoomId || '').trim();
    if (!roomId) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Invalid room ID.' });
      }
      return;
    }

    const room = getOrCreateRoom(roomId);
    const playerNumber = assignPlayerSeat(room, socket.id);

    if (!playerNumber) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Room is full. Create a new room.' });
      }

      socket.emit('full', { roomId });
      return;
    }

    socket.join(roomId);

    if (typeof ack === 'function') {
      ack({
        ok: true,
        roomId,
        playerNumber,
        rows: ROWS,
        cols: COLS,
        state: {
          board: room.board,
          currentPlayer: room.currentPlayer,
          winner: room.winner,
          moveCount: room.moveCount,
          playerCount: getPlayerCount(room)
        }
      });
    }

    io.to(roomId).emit('room update', {
      playerCount: getPlayerCount(room),
      currentPlayer: room.currentPlayer,
      winner: room.winner
    });
  });

  socket.on('move', (payload = {}, ack) => {
    const roomId = String(payload.roomId || '').trim();
    const col = payload.col;

    if (!rooms.has(roomId)) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Room not found.' });
      }
      return;
    }

    const room = rooms.get(roomId);
    const playerNumber = getPlayerNumber(room, socket.id);

    if (!playerNumber) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'You are not a player in this room.' });
      }
      return;
    }

    if (getPlayerCount(room) < 2) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Waiting for opponent to join.' });
      }
      return;
    }

    if (room.winner !== null) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Game is already over.' });
      }
      return;
    }

    if (room.players[room.currentPlayer - 1] !== socket.id) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Not your turn.' });
      }
      return;
    }

    if (!Number.isInteger(col) || col < 0 || col >= COLS) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Invalid column.' });
      }
      return;
    }

    const row = dropPiece(room.board, col, playerNumber);
    if (row === -1) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Column is full.' });
      }
      return;
    }

    room.moveCount += 1;

    if (checkWin(room.board, row, col, playerNumber)) {
      room.winner = playerNumber;
    } else if (room.moveCount === ROWS * COLS) {
      room.winner = 0;
    } else {
      room.currentPlayer = room.currentPlayer === 1 ? 2 : 1;
    }

    const gameState = {
      row,
      col,
      player: playerNumber,
      board: room.board,
      currentPlayer: room.currentPlayer,
      winner: room.winner,
      moveCount: room.moveCount
    };

    io.to(roomId).emit('move made', gameState);

    if (typeof ack === 'function') {
      ack({ ok: true, gameState });
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      const leavingPlayer = getPlayerNumber(room, socket.id);
      if (leavingPlayer === 1) {
        room.players[0] = null;
      } else if (leavingPlayer === 2) {
        room.players[1] = null;
      }

      if (leavingPlayer) {
        if (room.winner === null && getPlayerCount(room) === 1) {
          room.currentPlayer = room.players[0] ? 1 : 2;
        }

        io.to(roomId).emit('room update', {
          playerCount: getPlayerCount(room),
          currentPlayer: room.currentPlayer,
          winner: room.winner,
          message: 'A player disconnected.'
        });
      }

      const connectedCount = io.sockets.adapter.rooms.get(roomId)?.size || 0;
      if (getPlayerCount(room) === 0 && connectedCount === 0) {
        rooms.delete(roomId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
