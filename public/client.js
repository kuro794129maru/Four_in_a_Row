const ROWS = 6;
const COLS = 7;

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('room');
}

function redirectToRoom(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  const targetUrl = url.toString();
  window.location.replace(targetUrl);
  return targetUrl;
}

let roomId = getRoomIdFromUrl();
let shareUrl = window.location.href;
if (!roomId) {
  roomId = generateRoomId();
  shareUrl = redirectToRoom(roomId);
}

const roomIdEl = document.getElementById('room-id');
const statusEl = document.getElementById('status');
const boardEl = document.getElementById('board');
const shareUrlEl = document.getElementById('share-url');
const createRoomBtn = document.getElementById('create-room');
const copyUrlBtn = document.getElementById('copy-url');
const rematchBtn = document.getElementById('rematch-btn');
const playerBadgeEl = document.getElementById('player-badge');
const turnBadgeEl = document.getElementById('turn-badge');

let board = createEmptyBoard();
let role = 'spectator';
let playerNumber = 0;
let currentTurn = null;
let currentTurnPlayer = 0;
let winner = null;
let playerCount = 0;
let spectatorCount = 0;
let rematchVotes = 0;
let roomMessage = '';
let hasVotedRematch = false;

let hoveredCol = null;
let lastMove = null;
let animatedMoveId = null;

roomIdEl.textContent = roomId;
shareUrlEl.value = shareUrl;

function getDropRow(col) {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row][col] === 0) {
      return row;
    }
  }

  return -1;
}

function canPlay() {
  return role === 'player' && winner === null && playerCount === 2;
}

function canHoverColumn() {
  return canPlay() && currentTurn === socket.id;
}

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.className = `status status-${tone}`;
}

function updatePlayerBadge() {
  if (role === 'spectator') {
    playerBadgeEl.textContent = 'You are Spectator';
    playerBadgeEl.className = 'badge player-badge player-spectator';
    return;
  }

  if (playerNumber === 1) {
    playerBadgeEl.textContent = 'You are Red';
    playerBadgeEl.className = 'badge player-badge player-red';
    return;
  }

  if (playerNumber === 2) {
    playerBadgeEl.textContent = 'You are Yellow';
    playerBadgeEl.className = 'badge player-badge player-yellow';
    return;
  }

  playerBadgeEl.textContent = 'Connecting...';
  playerBadgeEl.className = 'badge player-badge player-neutral';
}

function updateRematchButton() {
  const showRematch = role === 'player' && winner !== null && playerCount === 2;

  rematchBtn.classList.toggle('hidden', !showRematch);

  if (!showRematch) {
    rematchBtn.disabled = false;
    rematchBtn.textContent = 'Rematch';
    return;
  }

  if (hasVotedRematch && rematchVotes < 2) {
    rematchBtn.disabled = true;
    rematchBtn.textContent = 'Waiting...';
    return;
  }

  rematchBtn.disabled = false;
  rematchBtn.textContent = 'Rematch';
}

function updateTurnAndStatus() {
  if (winner === 1 || winner === 2) {
    if (role === 'player') {
      const isWinner = winner === playerNumber;
      turnBadgeEl.textContent = isWinner ? 'You win' : 'You lose';
      turnBadgeEl.className = `badge turn-badge ${isWinner ? 'turn-win' : 'turn-lose'}`;

      if (hasVotedRematch && rematchVotes < 2) {
        setStatus('Waiting for opponent to accept rematch...', 'info');
      } else if (!hasVotedRematch && rematchVotes > 0) {
        setStatus('Opponent requested a rematch. Click Rematch to accept.', 'info');
      } else {
        setStatus(isWinner ? 'You win!' : 'You lose.', isWinner ? 'success' : 'danger');
      }
      return;
    }

    turnBadgeEl.textContent = 'Game ended';
    turnBadgeEl.className = 'badge turn-badge turn-neutral';
    if (rematchVotes > 0) {
      setStatus('Players are voting for a rematch...', 'info');
    } else {
      setStatus(`Player ${winner} won.`, 'neutral');
    }
    return;
  }

  if (winner === 0) {
    turnBadgeEl.textContent = 'Draw';
    turnBadgeEl.className = 'badge turn-badge turn-neutral';

    if (role === 'player') {
      if (hasVotedRematch && rematchVotes < 2) {
        setStatus('Draw game. Waiting for opponent to accept rematch...', 'info');
      } else if (!hasVotedRematch && rematchVotes > 0) {
        setStatus('Draw game. Opponent requested rematch.', 'info');
      } else {
        setStatus('Draw game.', 'neutral');
      }
    } else if (rematchVotes > 0) {
      setStatus('Draw game. Players are voting for rematch...', 'info');
    } else {
      setStatus('Draw game.', 'neutral');
    }
    return;
  }

  if (role === 'spectator') {
    turnBadgeEl.textContent = 'Spectating';
    turnBadgeEl.className = 'badge turn-badge turn-neutral';

    if (playerCount < 2) {
      setStatus('Waiting for players to join...', 'warning');
      return;
    }

    if (currentTurnPlayer > 0) {
      setStatus(`You are Spectator. Player ${currentTurnPlayer}'s turn.`, 'info');
    } else {
      setStatus('You are Spectator. Watching live game.', 'info');
    }
    return;
  }

  if (playerCount < 2) {
    turnBadgeEl.textContent = 'Waiting';
    turnBadgeEl.className = 'badge turn-badge turn-neutral';
    setStatus('Waiting for opponent...', 'warning');
    return;
  }

  const yourTurn = currentTurn === socket.id;
  turnBadgeEl.textContent = yourTurn ? 'Your turn' : "Opponent's turn";
  turnBadgeEl.className = `badge turn-badge ${yourTurn ? 'turn-your' : 'turn-opponent'}`;
  setStatus(yourTurn ? 'Game started. Your turn.' : "Game started. Opponent's turn.", yourTurn ? 'info' : 'neutral');
}

function updateHud() {
  updatePlayerBadge();
  updateTurnAndStatus();
  updateRematchButton();
}

function renderBoard() {
  const interactive = canPlay();
  const allowHover = canHoverColumn();
  const previewRow = allowHover && hoveredCol !== null ? getDropRow(hoveredCol) : -1;

  boardEl.classList.toggle('interactive', interactive);
  boardEl.classList.toggle('spectator', role === 'spectator');
  boardEl.innerHTML = '';

  let animatedInThisRender = false;

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cell = document.createElement('button');
      cell.className = 'cell';
      cell.type = 'button';
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute('aria-label', `Drop in column ${col + 1}`);
      cell.setAttribute('title', `Drop in column ${col + 1}`);

      const value = board[row][col];
      if (value === 1) {
        cell.classList.add('player1');
      } else if (value === 2) {
        cell.classList.add('player2');
      } else if (allowHover && hoveredCol === col && previewRow === row) {
        cell.classList.add(playerNumber === 1 ? 'preview-player1' : 'preview-player2');
      }

      if (allowHover && hoveredCol === col) {
        cell.classList.add('column-hover');
      }

      if (
        !animatedInThisRender
        && lastMove
        && lastMove.id !== animatedMoveId
        && lastMove.row === row
        && lastMove.col === col
        && value === lastMove.player
      ) {
        cell.classList.add('drop');
        cell.style.setProperty('--drop-distance', `${(row + 1) * 68}px`);
        animatedInThisRender = true;
      }

      cell.addEventListener('mouseenter', () => {
        if (!allowHover || hoveredCol === col) {
          return;
        }

        hoveredCol = col;
        renderBoard();
      });

      cell.addEventListener('focus', () => {
        if (!allowHover || hoveredCol === col) {
          return;
        }

        hoveredCol = col;
        renderBoard();
      });

      cell.addEventListener('click', () => {
        if (role === 'spectator') {
          setStatus('You are Spectator. Watching only.', 'warning');
          return;
        }

        if (winner !== null) {
          return;
        }

        if (playerCount < 2) {
          setStatus('Waiting for opponent...', 'warning');
          return;
        }

        if (currentTurn !== socket.id) {
          setStatus("Opponent's turn.", 'neutral');
          return;
        }

        const dropRow = getDropRow(col);
        if (dropRow === -1) {
          setStatus('This column is full. Choose another column.', 'warning');
          return;
        }

        socket.emit('move', { roomId, col }, (response) => {
          if (!response || response.ok) {
            return;
          }

          setStatus(response.error || 'Move failed.', 'danger');
        });
      });

      boardEl.appendChild(cell);
    }
  }

  if (animatedInThisRender && lastMove) {
    animatedMoveId = lastMove.id;
  }
}

boardEl.addEventListener('mouseleave', () => {
  if (hoveredCol === null) {
    return;
  }

  hoveredCol = null;
  renderBoard();
});

createRoomBtn.addEventListener('click', () => {
  const newRoomId = generateRoomId();
  const newUrl = new URL(window.location.href);
  newUrl.searchParams.set('room', newRoomId);
  window.location.href = newUrl.toString();
});

copyUrlBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shareUrlEl.value);
    const originalText = copyUrlBtn.textContent;

    copyUrlBtn.textContent = 'Copied!';
    copyUrlBtn.classList.add('copied');

    setTimeout(() => {
      copyUrlBtn.textContent = originalText;
      copyUrlBtn.classList.remove('copied');
    }, 1200);
  } catch (err) {
    setStatus('Clipboard permission blocked. Copy manually.', 'warning');
  }
});

rematchBtn.addEventListener('click', () => {
  if (role !== 'player' || winner === null) {
    return;
  }

  socket.emit('rematch_request', { roomId }, (response) => {
    if (!response || !response.ok) {
      setStatus(response?.error || 'Rematch request failed.', 'danger');
      return;
    }

    hasVotedRematch = true;
    if (typeof response.votes === 'number') {
      rematchVotes = response.votes;
    }

    updateHud();
  });
});

const socket = io();

socket.on('connect', () => {
  socket.emit('join room', roomId, (response) => {
    if (!response || !response.ok) {
      setStatus(response?.error || 'Could not join room.', 'danger');
      return;
    }

    role = response.role || (response.playerNumber ? 'player' : 'spectator');
    playerNumber = response.playerNumber || 0;

    board = response.state.board;
    currentTurn = response.state.currentTurn;
    currentTurnPlayer = response.state.currentTurnPlayer || 0;
    winner = response.state.winner;
    playerCount = response.state.playerCount || 0;
    spectatorCount = response.state.spectatorCount || 0;
    rematchVotes = response.state.rematchVotes || 0;

    hoveredCol = null;
    roomMessage = '';
    hasVotedRematch = false;
    lastMove = null;

    renderBoard();
    updateHud();
  });
});

socket.on('room update', (payload) => {
  if (typeof payload.playerCount === 'number') {
    playerCount = payload.playerCount;
  }

  if (typeof payload.spectatorCount === 'number') {
    spectatorCount = payload.spectatorCount;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'currentTurn')) {
    currentTurn = payload.currentTurn;
  }

  if (typeof payload.currentTurnPlayer === 'number') {
    currentTurnPlayer = payload.currentTurnPlayer;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'winner')) {
    winner = payload.winner;
  }

  if (typeof payload.rematchVotes === 'number') {
    rematchVotes = payload.rematchVotes;
  }

  roomMessage = payload.message || '';

  renderBoard();
  updateHud();
});

socket.on('move made', (payload) => {
  board = payload.board;
  currentTurn = payload.currentTurn;
  currentTurnPlayer = payload.currentTurnPlayer || 0;
  winner = payload.winner;

  lastMove = {
    row: payload.row,
    col: payload.col,
    player: payload.player,
    id: payload.moveCount
  };

  hoveredCol = null;
  roomMessage = '';

  renderBoard();
  updateHud();
});

socket.on('rematch_update', (payload) => {
  rematchVotes = payload.votes || 0;

  if (role === 'player' && Array.isArray(payload.voters)) {
    hasVotedRematch = payload.voters.includes(playerNumber);
  }

  updateHud();
});

socket.on('rematch_start', (payload) => {
  board = payload.board || createEmptyBoard();
  currentTurn = payload.currentTurn || null;
  currentTurnPlayer = payload.currentTurnPlayer || 0;
  winner = payload.winner;

  hoveredCol = null;
  lastMove = null;
  animatedMoveId = null;

  rematchVotes = 0;
  hasVotedRematch = false;
  roomMessage = 'Rematch started.';

  renderBoard();
  updateHud();
  setStatus('Rematch started!', 'success');
});

renderBoard();
updateHud();
