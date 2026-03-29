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
      players: [null, null],
      spectators: [],
      board: createEmptyBoard(),
      currentTurn: null,
      winner: null,
      moveCount: 0,
      rematchVotes: []
    });
  }

  return rooms.get(roomId);
}

function getPlayerSeat(room, socketId) {
  if (room.players[0] === socketId) {
    return 0;
  }

  if (room.players[1] === socketId) {
    return 1;
  }

  return -1;
}

function getPlayerCount(room) {
  return room.players.filter(Boolean).length;
}

function getSpectatorCount(room) {
  return room.spectators.length;
}

function getCurrentTurnPlayer(room) {
  if (!room.currentTurn) {
    return 0;
  }

  const seat = getPlayerSeat(room, room.currentTurn);
  return seat === -1 ? 0 : seat + 1;
}

function getNextTurnSocketId(room, seat) {
  const otherSeat = seat === 0 ? 1 : 0;
  return room.players[otherSeat] || room.players[seat] || null;
}

function assignRole(room, socketId) {
  const existingSeat = getPlayerSeat(room, socketId);
  if (existingSeat !== -1) {
    return { role: 'player', playerNumber: existingSeat + 1 };
  }

  if (room.spectators.includes(socketId)) {
    return { role: 'spectator', playerNumber: 0 };
  }

  if (!room.players[0]) {
    room.players[0] = socketId;
    if (!room.currentTurn) {
      room.currentTurn = socketId;
    }

    return { role: 'player', playerNumber: 1 };
  }

  if (!room.players[1]) {
    room.players[1] = socketId;
    if (!room.currentTurn) {
      room.currentTurn = room.players[0] || socketId;
    }

    return { role: 'player', playerNumber: 2 };
  }

  room.spectators.push(socketId);
  return { role: 'spectator', playerNumber: 0 };
}

function dropPiece(board, col, playerToken) {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row][col] === EMPTY) {
      board[row][col] = playerToken;
      return row;
    }
  }

  return -1;
}

function checkWin(board, row, col, playerToken) {
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
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === playerToken) {
      count += 1;
      r += dr;
      c += dc;
    }

    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === playerToken) {
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

function emitRoomUpdate(roomId, room, message = '') {
  io.to(roomId).emit('room update', {
    playerCount: getPlayerCount(room),
    spectatorCount: getSpectatorCount(room),
    currentTurn: room.currentTurn,
    currentTurnPlayer: getCurrentTurnPlayer(room),
    winner: room.winner,
    rematchVotes: room.rematchVotes.length,
    message
  });
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
    const { role, playerNumber } = assignRole(room, socket.id);

    socket.join(roomId);

    if (typeof ack === 'function') {
      ack({
        ok: true,
        roomId,
        role,
        playerNumber,
        rows: ROWS,
        cols: COLS,
        state: {
          board: room.board,
          currentTurn: room.currentTurn,
          currentTurnPlayer: getCurrentTurnPlayer(room),
          winner: room.winner,
          moveCount: room.moveCount,
          playerCount: getPlayerCount(room),
          spectatorCount: getSpectatorCount(room),
          rematchVotes: room.rematchVotes.length
        }
      });
    }

    const joinMessage = role === 'spectator' ? 'A spectator joined.' : `Player ${playerNumber} joined.`;
    emitRoomUpdate(roomId, room, joinMessage);
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
    const seat = getPlayerSeat(room, socket.id);

    if (seat === -1) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Spectators cannot make moves.' });
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

    if (room.currentTurn !== socket.id) {
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

    const playerToken = seat + 1;
    const row = dropPiece(room.board, col, playerToken);
    if (row === -1) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Column is full.' });
      }
      return;
    }

    room.moveCount += 1;

    if (checkWin(room.board, row, col, playerToken)) {
      room.winner = playerToken;
    } else if (room.moveCount === ROWS * COLS) {
      room.winner = 0;
    } else {
      room.currentTurn = getNextTurnSocketId(room, seat);
    }

    const gameState = {
      row,
      col,
      player: playerToken,
      board: room.board,
      currentTurn: room.currentTurn,
      currentTurnPlayer: getCurrentTurnPlayer(room),
      winner: room.winner,
      moveCount: room.moveCount
    };

    io.to(roomId).emit('move made', gameState);
    emitRoomUpdate(roomId, room);

    if (typeof ack === 'function') {
      ack({ ok: true, gameState });
    }
  });

  socket.on('rematch_request', (payload = {}, ack) => {
    const roomId = String(payload.roomId || '').trim();

    if (!rooms.has(roomId)) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Room not found.' });
      }
      return;
    }

    const room = rooms.get(roomId);
    const seat = getPlayerSeat(room, socket.id);

    if (seat === -1) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Only players can request rematch.' });
      }
      return;
    }

    if (room.winner === null) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Rematch is available after game end.' });
      }
      return;
    }

    if (getPlayerCount(room) < 2) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Waiting for opponent to join.' });
      }
      return;
    }

    if (!room.rematchVotes.includes(socket.id)) {
      room.rematchVotes.push(socket.id);
    }

    const voters = room.rematchVotes
      .map((id) => getPlayerSeat(room, id) + 1)
      .filter((playerNumber) => playerNumber > 0);

    io.to(roomId).emit('rematch_update', {
      votes: room.rematchVotes.length,
      needed: 2,
      voters
    });

    emitRoomUpdate(roomId, room, 'Rematch vote received.');

    const bothAgreed = room.players[0] && room.players[1]
      && room.rematchVotes.includes(room.players[0])
      && room.rematchVotes.includes(room.players[1]);

    if (bothAgreed) {
      room.board = createEmptyBoard();
      room.currentTurn = room.players[0] || room.players[1] || null;
      room.winner = null;
      room.moveCount = 0;
      room.rematchVotes = [];

      io.to(roomId).emit('rematch_start', {
        board: room.board,
        currentTurn: room.currentTurn,
        currentTurnPlayer: getCurrentTurnPlayer(room),
        winner: room.winner,
        moveCount: room.moveCount
      });

      emitRoomUpdate(roomId, room, 'Rematch started.');

      if (typeof ack === 'function') {
        ack({ ok: true, started: true });
      }
      return;
    }

    if (typeof ack === 'function') {
      ack({ ok: true, started: false, votes: room.rematchVotes.length });
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      let changed = false;
      let message = '';

      const seat = getPlayerSeat(room, socket.id);
      if (seat !== -1) {
        room.players[seat] = null;
        room.rematchVotes = room.rematchVotes.filter((id) => id !== socket.id);

        if (room.winner === null) {
          room.currentTurn = room.players[0] || room.players[1] || null;
        }

        changed = true;
        message = 'A player disconnected.';
      }

      const spectatorIdx = room.spectators.indexOf(socket.id);
      if (spectatorIdx !== -1) {
        room.spectators.splice(spectatorIdx, 1);
        changed = true;
        if (!message) {
          message = 'A spectator left.';
        }
      }

      if (changed) {
        emitRoomUpdate(roomId, room, message);
      }

      const connectedCount = io.sockets.adapter.rooms.get(roomId)?.size || 0;
      if (getPlayerCount(room) === 0 && getSpectatorCount(room) === 0 && connectedCount === 0) {
        rooms.delete(roomId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
