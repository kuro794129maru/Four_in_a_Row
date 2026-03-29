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
const playerBadgeEl = document.getElementById('player-badge');
const turnBadgeEl = document.getElementById('turn-badge');

let board = createEmptyBoard();
let playerNumber = 0;
let currentPlayer = 1;
let winner = null;
let playerCount = 0;
let roomMessage = '';

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
  return playerNumber > 0 && winner === null && playerCount === 2;
}

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.className = `status status-${tone}`;
}

function updatePlayerBadge() {
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

  playerBadgeEl.textContent = 'Spectator';
  playerBadgeEl.className = 'badge player-badge player-neutral';
}

function updateTurnAndStatus() {
  if (winner === 1 || winner === 2) {
    if (playerNumber > 0) {
      const isWinner = winner === playerNumber;
      turnBadgeEl.textContent = isWinner ? 'You win' : 'You lose';
      turnBadgeEl.className = `badge turn-badge ${isWinner ? 'turn-win' : 'turn-lose'}`;
      setStatus(isWinner ? 'You win!' : 'You lose.', isWinner ? 'success' : 'danger');
    } else {
      turnBadgeEl.textContent = `Player ${winner} won`;
      turnBadgeEl.className = 'badge turn-badge turn-lose';
      setStatus(`Player ${winner} wins.`, 'danger');
    }
    return;
  }

  if (winner === 0) {
    turnBadgeEl.textContent = 'Draw';
    turnBadgeEl.className = 'badge turn-badge turn-neutral';
    setStatus('Draw game.', 'neutral');
    return;
  }

  if (playerNumber === 0) {
    turnBadgeEl.textContent = 'Spectating';
    turnBadgeEl.className = 'badge turn-badge turn-neutral';
    setStatus('Room is full. Use Create Room to start another match.', 'warning');
    return;
  }

  if (playerCount < 2) {
    turnBadgeEl.textContent = 'Waiting';
    turnBadgeEl.className = 'badge turn-badge turn-neutral';

    const waitingMessage = roomMessage
      ? `${roomMessage} Waiting for opponent...`
      : 'Waiting for opponent...';

    setStatus(waitingMessage, 'warning');
    return;
  }

  const yourTurn = currentPlayer === playerNumber;
  turnBadgeEl.textContent = yourTurn ? 'Your turn' : "Opponent's turn";
  turnBadgeEl.className = `badge turn-badge ${yourTurn ? 'turn-your' : 'turn-opponent'}`;
  setStatus(yourTurn ? 'Game started. Your turn.' : "Game started. Opponent's turn.", yourTurn ? 'info' : 'neutral');
}

function updateHud() {
  updatePlayerBadge();
  updateTurnAndStatus();
}

function renderBoard() {
  const interactive = canPlay();
  const previewRow = interactive && hoveredCol !== null ? getDropRow(hoveredCol) : -1;

  boardEl.classList.toggle('interactive', interactive);
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
      } else if (interactive && hoveredCol === col && previewRow === row) {
        cell.classList.add(playerNumber === 1 ? 'preview-player1' : 'preview-player2');
      }

      if (interactive && hoveredCol === col) {
        cell.classList.add('column-hover');
      }

      if (
        !animatedInThisRender &&
        lastMove &&
        lastMove.id !== animatedMoveId &&
        lastMove.row === row &&
        lastMove.col === col &&
        value === lastMove.player
      ) {
        cell.classList.add('drop');
        cell.style.setProperty('--drop-distance', `${(row + 1) * 68}px`);
        animatedInThisRender = true;
      }

      cell.addEventListener('mouseenter', () => {
        if (!interactive || hoveredCol === col) {
          return;
        }

        hoveredCol = col;
        renderBoard();
      });

      cell.addEventListener('focus', () => {
        if (!interactive || hoveredCol === col) {
          return;
        }

        hoveredCol = col;
        renderBoard();
      });

      cell.addEventListener('click', () => {
        if (winner !== null) {
          return;
        }

        if (playerNumber === 0) {
          setStatus('Room is full. Use Create Room to start another match.', 'warning');
          return;
        }

        if (playerCount < 2) {
          setStatus('Waiting for opponent...', 'warning');
          return;
        }

        if (currentPlayer !== playerNumber) {
          setStatus("Opponent's turn.", 'neutral');
          return;
        }

        const dropRow = getDropRow(col);
        if (dropRow === -1) {
          setStatus('This column is full. Choose another column.', 'warning');
          return;
        }

        roomMessage = '';

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

const socket = io();

socket.on('connect', () => {
  socket.emit('join room', roomId, (response) => {
    if (!response || !response.ok) {
      setStatus(response?.error || 'Could not join room.', 'danger');
      return;
    }

    playerNumber = response.playerNumber;
    board = response.state.board;
    currentPlayer = response.state.currentPlayer;
    winner = response.state.winner;
    playerCount = response.state.playerCount;

    hoveredCol = null;
    roomMessage = '';
    lastMove = null;

    renderBoard();
    updateHud();
  });
});

socket.on('room update', (payload) => {
  if (typeof payload.playerCount === 'number') {
    playerCount = payload.playerCount;
  }

  if (typeof payload.currentPlayer === 'number') {
    currentPlayer = payload.currentPlayer;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'winner')) {
    winner = payload.winner;
  }

  roomMessage = payload.message || '';

  renderBoard();
  updateHud();
});

socket.on('move made', (payload) => {
  board = payload.board;
  currentPlayer = payload.currentPlayer;
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

socket.on('full', () => {
  playerNumber = 0;
  updateHud();
  renderBoard();
});

renderBoard();
updateHud();
