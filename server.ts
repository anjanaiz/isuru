
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";

// --- CUSTOM TYPES ---
interface Player {
  id: string;
  name: string;
  coins: number;
}

interface MatchSlot {
  playerId: string | null;
  playerName: string | null;
  roll: number | null;
}

interface MatchHistoryRecord {
  id: string;
  p1: string;
  p2: string;
  winner: string;
  pool: number;
  commission: number;
  timestamp: number;
}

interface GameState {
  slots: MatchSlot[];
  status: 'WAITING' | 'PLAYING' | 'RESULT';
  winnerId: string | null;
  totalPool: number;
  ownerFee: number;
  winnerPrize: number;
  currentEntryFee: number;
  spinningSlotIdx: number | null;
}

// --- SERVER SETUP ---
async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  const PORT = 3000;

  // Persistence (Best effort without DB)
  const COINS_FILE = path.join(process.cwd(), 'coins.json');
  const HISTORY_FILE = path.join(process.cwd(), 'history.json');
  
  let playerCoins: Record<string, number> = {};
  let matchHistory: MatchHistoryRecord[] = [];

  if (fs.existsSync(COINS_FILE)) {
    try {
      playerCoins = JSON.parse(fs.readFileSync(COINS_FILE, 'utf-8'));
    } catch (e) {
      console.error("Failed to load coins", e);
    }
  }

  if (fs.existsSync(HISTORY_FILE)) {
    try {
      matchHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch (e) {
      console.error("Failed to load history", e);
    }
  }

  function saveData() {
    fs.writeFileSync(COINS_FILE, JSON.stringify(playerCoins, null, 2));
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(matchHistory, null, 2));
  }

  // GAME LOGIC STATE
  let gameState: GameState = {
    slots: [
      { playerId: null, playerName: null, roll: null },
      { playerId: null, playerName: null, roll: null }
    ],
    status: 'WAITING',
    winnerId: null,
    totalPool: 0,
    ownerFee: 0,
    winnerPrize: 0,
    currentEntryFee: 10,
    spinningSlotIdx: null
  };

  function resetMatch(isDraw = false) {
    const nextFee = isDraw ? (gameState.currentEntryFee * 2) : 10;
    gameState = {
      slots: [
        { playerId: null, playerName: null, roll: null },
        { playerId: null, playerName: null, roll: null }
      ],
      status: 'WAITING',
      winnerId: null,
      totalPool: 0,
      ownerFee: 0,
      winnerPrize: 0,
      currentEntryFee: nextFee,
      spinningSlotIdx: null
    };
  }

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Initial state
    socket.emit("game:state", gameState);
    
    // If admin connects, we might want to send history?
    // Let's just have an event for it.
    socket.on("admin:get_stats", () => {
       const totalCommission = matchHistory.reduce((acc, curr) => acc + curr.commission, 0);
       socket.emit("admin:stats", {
          totalMatches: matchHistory.length,
          totalCommission,
          history: matchHistory.slice(-50) // Last 50 matches
       });
    });

    socket.on("match:setup", ({ p1, p2 }: { p1: { name: string, id: string }, p2: { name: string, id: string } }) => {
      // Keep existing setup for backwards compatibility or single-device testing
      if (gameState.status !== 'WAITING') return;

      [p1, p2].forEach(p => {
        if (playerCoins[p.id] === undefined) playerCoins[p.id] = 100;
      });

      const required = gameState.currentEntryFee;
      if (playerCoins[p1.id] < required || playerCoins[p2.id] < required) {
        socket.emit("error", `One or both players lack enough coins (${required} required)`);
        return;
      }

      playerCoins[p1.id] -= required;
      playerCoins[p2.id] -= required;
      gameState.totalPool = required * 2;
      
      gameState.slots[0] = { playerId: p1.id, playerName: p1.name, roll: null };
      gameState.slots[1] = { playerId: p2.id, playerName: p2.name, roll: null };
      gameState.status = 'PLAYING';
      
      saveData();
      io.emit("game:state", gameState);
      io.emit("broadcast:coins", playerCoins);
    });

    socket.on("player:join", ({ name, playerId }: { name: string, playerId: string }) => {
      if (playerCoins[playerId] === undefined) {
        playerCoins[playerId] = 100;
        saveData();
      }

      const existingIdx = gameState.slots.findIndex(s => s.playerId === playerId);
      if (existingIdx !== -1) {
        gameState.slots[existingIdx].playerName = name;
      } else {
        const targetIdx = gameState.slots.findIndex(s => s.playerId === null);
        if (targetIdx !== -1 && gameState.status === 'WAITING') {
          if (playerCoins[playerId] >= gameState.currentEntryFee) {
            playerCoins[playerId] -= gameState.currentEntryFee;
            gameState.totalPool += gameState.currentEntryFee;
            gameState.slots[targetIdx] = { playerId, playerName: name, roll: null };
            saveData();
          } else {
            socket.emit("error", `Not enough coins (Need ${gameState.currentEntryFee})`);
            return;
          }
        }
      }

      const filledSlots = gameState.slots.filter(s => s.playerId !== null).length;
      if (filledSlots === 2 && gameState.status === 'WAITING') {
        gameState.status = 'PLAYING';
      }

      io.emit("game:state", gameState);
      socket.emit("player:coins", playerCoins[playerId]);
    });

    socket.on("player:roll", ({ playerId }: { playerId: string }) => {
      if (gameState.spinningSlotIdx !== null) return;
      const slotIdx = gameState.slots.findIndex(s => s.playerId === playerId);
      if (slotIdx === -1 || gameState.status !== 'PLAYING') return;
      if (gameState.slots[slotIdx].roll !== null) return;

      const firstNullIdx = gameState.slots.findIndex(s => s.roll === null);
      if (slotIdx !== firstNullIdx) {
         socket.emit("error", "It is not your turn!");
         return;
      }

      gameState.spinningSlotIdx = slotIdx;
      io.emit("game:state", gameState);

      setTimeout(() => {
        if (gameState.spinningSlotIdx !== slotIdx) return;

        const roll = Math.floor(Math.random() * 6) + 1;
        gameState.slots[slotIdx].roll = roll;
        gameState.spinningSlotIdx = null;

        const allRolled = gameState.slots.every(s => s.roll !== null);
        if (allRolled) {
          gameState.status = 'RESULT';
          
          let maxRoll = 0;
          gameState.slots.forEach(s => { if (s.roll! > maxRoll) maxRoll = s.roll!; });
          
          const winners = gameState.slots.filter(s => s.roll === maxRoll);
          
          gameState.ownerFee = gameState.totalPool * 0.1;
          gameState.winnerPrize = gameState.totalPool - gameState.ownerFee;
          
          let winnerName = 'DRAW';
          if (winners.length === 1) {
            const winner = winners[0];
            playerCoins[winner.playerId!] += gameState.winnerPrize;
            gameState.winnerId = winner.playerId;
            winnerName = winner.playerName || 'Unknown';
          } else {
            gameState.winnerId = 'MULTIPLE';
            gameState.slots.forEach(s => {
               playerCoins[s.playerId!] += (gameState.totalPool / 2);
            });
            winnerName = 'TIE/DRAW';
          }

          // Record History
          matchHistory.push({
            id: 'm_' + Math.random().toString(36).substring(2, 9),
            p1: gameState.slots[0].playerName || 'P1',
            p2: gameState.slots[1].playerName || 'P2',
            winner: winnerName,
            pool: gameState.totalPool,
            commission: gameState.ownerFee,
            timestamp: Date.now()
          });

          saveData();
          
          // Notify Admin
          const totalCommission = matchHistory.reduce((acc, curr) => acc + curr.commission, 0);
          io.emit("admin:stats_update", {
             totalMatches: matchHistory.length,
             totalCommission,
             lastMatch: matchHistory[matchHistory.length - 1]
          });
        }

        io.emit("game:state", gameState);
        io.emit("broadcast:coins", playerCoins);
      }, 1500);
    });

    socket.on("match:reset", () => {
      if (gameState.status === 'RESULT') {
        const isDraw = gameState.winnerId === 'MULTIPLE';
        resetMatch(isDraw);
        io.emit("game:state", gameState);
      }
    });

    socket.on("get:coins", (playerId: string) => {
      socket.emit("player:coins", playerCoins[playerId] || 100);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
