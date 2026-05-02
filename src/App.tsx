/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Coins, Trophy, RotateCcw, LogOut, Swords, User, Cpu, Info, Users, Crown } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

// --- TYPES ---
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

interface AdminStats {
  totalMatches: number;
  totalCommission: number;
  history: MatchHistoryRecord[];
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

// --- SOUND UTILITY ---
const playHitSound = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.2);
    
    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.warn("Audio Context blocked or not supported", e);
  }
};

// --- COMPONENTS ---

const DiceDots = ({ value }: { value: number }) => {
  const getDotPositions = (val: number) => {
    switch (val) {
      case 1: return [4];
      case 2: return [0, 8];
      case 3: return [0, 4, 8];
      case 4: return [0, 2, 6, 8];
      case 5: return [0, 2, 4, 6, 8];
      case 6: return [0, 2, 3, 5, 6, 8];
      default: return [];
    }
  };

  const dots = getDotPositions(value);

  return (
    <div className="dots-container">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex items-center justify-center">
          {dots.includes(i) && <div className="dot" />}
        </div>
      ))}
    </div>
  );
};

const KataPiece = ({ value, isSpinning, isHighlighted, isWinner }: { value: number; isSpinning: boolean; isHighlighted: boolean; isWinner?: boolean }) => {
  // Map value to the correct rotation class
  const getRotationClass = () => {
    if (isSpinning) return 'animate-rolling';
    if (value >= 1 && value <= 6) return `show-${value}`;
    return ''; // Default
  };

  return (
    <div className={`kata-container relative transition-all duration-1000 ${
      isWinner 
        ? 'scale-125 z-30 opacity-100' 
        : isHighlighted 
          ? 'scale-110 opacity-100 z-10' 
          : 'scale-75 opacity-20 grayscale blur-[4px] z-0'
    }`}>
      <div className={`kata-piece ${getRotationClass()} ${isHighlighted ? 'drop-shadow-[0_20px_60px_rgba(0,0,0,0.8)]' : ''}`}>
        {[1, 2, 3, 4, 5, 6].map(faceVal => (
          <div 
            key={faceVal} 
            className={`kata-face face-${faceVal} ${isWinner && value === faceVal ? 'winner-glow' : ''}`}
          >
            {isSpinning ? (
               <div className="animate-pulse opacity-20">
                  <DiceDots value={Math.floor(Math.random() * 6) + 1} />
               </div>
            ) : value === faceVal ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.2, rotate: -45 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              >
                <DiceDots value={faceVal} />
              </motion.div>
            ) : (
              <span className="text-[10px] text-white/5 font-sans font-black">{faceVal}</span>
            )}
          </div>
        ))}
      </div>
      
      {!isSpinning && value === 0 && (
         <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <motion.div 
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               className="bg-black/80 backdrop-blur-3xl px-8 py-4 rounded-3xl border border-white/5 shadow-2xl transform -rotate-12"
            >
               <span className="text-[10px] uppercase tracking-[0.5em] font-black text-stone-500 block mb-1">Status</span>
               <span className="text-xl font-sinhala text-terracotta/60 font-black">සෙල්ලම එනතුරු</span>
            </motion.div>
         </div>
      )}
    </div>
  );
};

const AdminDashboard = ({ stats, socket }: { stats: AdminStats | null, socket: Socket | null }) => {
  const shareLink = `${window.location.origin}${window.location.pathname}?join=true`;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-6xl space-y-8 p-8"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-wood/40 border border-terracotta/20 p-8 rounded-3xl backdrop-blur-xl">
           <p className="text-stone-500 uppercase text-[10px] tracking-widest mb-2">Total Matches</p>
           <p className="text-4xl font-light text-white">{stats?.totalMatches || 0}</p>
        </div>
        <div className="bg-wood/40 border border-terracotta/20 p-8 rounded-3xl backdrop-blur-xl">
           <p className="text-stone-500 uppercase text-[10px] tracking-widest mb-2">Total Commission (10%)</p>
           <p className="text-4xl font-light text-gold flex items-center gap-2">
              <Coins className="w-8 h-8" /> {stats?.totalCommission.toFixed(2) || 0}
           </p>
        </div>
        <div className="bg-wood/40 border border-terracotta/20 p-8 rounded-3xl backdrop-blur-xl relative overflow-hidden group">
           <p className="text-stone-500 uppercase text-[10px] tracking-widest mb-2">Game Share Link</p>
           <p className="text-xs font-mono text-terracotta/80 truncate mb-4">{shareLink}</p>
           <button 
             onClick={() => {
                navigator.clipboard.writeText(shareLink);
                alert("Link copied! Share this with your friends.");
             }}
             className="text-[10px] uppercase font-bold text-white bg-terracotta px-4 py-2 rounded-full hover:bg-terracotta-dark transition-colors"
           >
             Copy Link for Players
           </button>
        </div>
      </div>

      <div className="bg-wood/40 border border-terracotta/20 rounded-[2rem] overflow-hidden backdrop-blur-xl text-white">
        <div className="p-6 border-b border-white/5 flex justify-between items-center text-white">
          <h3 className="text-stone-200 font-sans font-bold uppercase tracking-widest text-sm text-white">Match History</h3>
          <button 
             onClick={() => socket?.emit("admin:get_stats")}
             className="p-2 text-stone-500 hover:text-white transition-colors"
          >
             <RotateCcw className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-x-auto text-white">
          <table className="w-full text-left text-sm text-white">
            <thead className="bg-black/20 text-stone-500 uppercase text-[10px] tracking-widest text-white">
              <tr>
                <th className="px-6 py-4">ID</th>
                <th className="px-6 py-4">Players</th>
                <th className="px-6 py-4">Winner</th>
                <th className="px-6 py-4">Pool</th>
                <th className="px-6 py-4">Commission</th>
                <th className="px-6 py-4">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white">
              {stats?.history.slice().reverse().map(m => (
                <tr key={m.id} className="hover:bg-white/5 transition-colors text-white">
                  <td className="px-6 py-4 font-mono text-stone-500">{m.id.substring(2)}</td>
                  <td className="px-6 py-4 text-stone-200">{m.p1} vs {m.p2}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${m.winner === 'DRAW' || m.winner === 'TIE/DRAW' ? 'bg-stone-500/20 text-stone-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {m.winner}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gold flex items-center gap-1">
                    <Coins className="w-3 h-3" /> {m.pool}
                  </td>
                  <td className="px-6 py-4 text-amber-600">
                    🪙 {m.commission.toFixed(1)}
                  </td>
                  <td className="px-6 py-4 text-stone-600 text-[10px]">
                    {new Date(m.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myId, setMyId] = useState<string>('');
  const [myCoins, setMyCoins] = useState<number>(0);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [appMode, setAppMode] = useState<'AUTH' | 'PLAYER' | 'ADMIN'>('AUTH');
  const [playerNameInput, setPlayerNameInput] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isJoining = params.get('join') === 'true';

    let id = localStorage.getItem('kata_user_id');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('kata_user_id', id);
    }
    setMyId(id);

    const savedName = localStorage.getItem('kata_user_name') || '';
    setPlayerNameInput(savedName);

    const s = io();
    setSocket(s);

    s.on("game:state", (state: GameState) => {
      setGameState(state);
    });

    s.on("player:coins", (c: number) => {
      setMyCoins(c);
    });

    s.on("broadcast:coins", (allCoins: Record<string, number>) => {
      const currentId = localStorage.getItem('kata_user_id');
      if (currentId && allCoins[currentId] !== undefined) {
        setMyCoins(allCoins[currentId]);
      }
    });

    s.on("admin:stats", (stats: AdminStats) => {
       setAdminStats(stats);
    });

    s.on("admin:stats_update", (update: any) => {
       setAdminStats(prev => {
          if (!prev) return null;
          return {
             totalMatches: update.totalMatches,
             totalCommission: update.totalCommission,
             history: [...prev.history, update.lastMatch].slice(-50)
          };
       });
    });

    s.on("error", (msg: string) => {
      alert(msg);
    });

    return () => {
      s.disconnect();
    };
  }, []);

  const isJoiningMode = new URLSearchParams(window.location.search).get('join') === 'true';

  const handlePlayerLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (playerNameInput.trim().length < 2) return;
    
    localStorage.setItem('kata_user_name', playerNameInput);
    socket?.emit("player:join", { name: playerNameInput, playerId: myId });
    setAppMode('PLAYER');
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPass === 'admin123') { // Simple pass for the demo
       setAppMode('ADMIN');
       socket?.emit("admin:get_stats");
    } else {
       alert("Invalid Admin Password");
    }
  };

  const handleRoll = () => {
    if (!gameState || gameState.spinningSlotIdx !== null) return;
    
    // Check if it's my turn
    const mySlotIdx = gameState.slots.findIndex(s => s.playerId === myId);
    const activeSlotIdx = gameState.slots.findIndex(s => s.roll === null);
    
    if (mySlotIdx !== activeSlotIdx) {
       alert("It's not your turn!");
       return;
    }

    playHitSound();
    socket?.emit("player:roll", { playerId: myId });
  };

  const handleReset = () => {
    socket?.emit("match:reset");
  };

  const logout = () => {
    setAppMode('AUTH');
  };

  if (!gameState) return <div className="min-h-screen flex items-center justify-center text-white/20 font-sans uppercase tracking-[1em]">Connecting...</div>;

  return (
    <div id="game-root" className="min-h-screen flex flex-col items-center justify-center p-4 bg-wood-dark">
      
      {/* --- HEADER --- */}
      {appMode !== 'AUTH' && (
        <motion.header 
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed top-0 left-0 w-full px-12 py-6 bg-wood-dark border-b border-wood/50 flex justify-between items-center z-50 shadow-2xl"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-terracotta flex items-center justify-center font-sans font-bold italic text-black">K</div>
            <div className="hidden sm:block">
              <h1 className="text-xs uppercase tracking-widest text-terracotta font-sans font-semibold">Kata Sellam</h1>
              <p className="text-xl font-light italic text-stone-200">
                {appMode === 'ADMIN' ? 'Admin Dashboard' : 'Player Arena'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-8">
            {appMode === 'PLAYER' && (
               <div className="flex items-center gap-4 bg-black/30 px-6 py-2 rounded-full border border-white/5">
                  <div className="text-right">
                    <p className="text-[10px] uppercase font-sans text-stone-500">Player: {playerNameInput}</p>
                    <div className="font-sans font-bold flex items-center justify-end gap-2 text-gold">
                      <Coins className="w-4 h-4" /> {myCoins}
                    </div>
                  </div>
               </div>
            )}
            
            <button onClick={logout} className="p-3 bg-white/5 hover:bg-white/10 rounded-full text-stone-500 hover:text-white transition-all">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </motion.header>
      )}

      <AnimatePresence mode="wait">
        {appMode === 'AUTH' && (
          <motion.div 
            key="login"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.1, opacity: 0 }}
            className="w-full max-w-4xl bg-wood/80 border-2 border-terracotta/40 p-12 rounded-[3.5rem] shadow-2xl backdrop-blur-3xl"
          >
             <div className="text-center mb-16">
              <h1 className="text-7xl font-sinhala font-black mb-4 text-terracotta drop-shadow-[0_0_20px_rgba(200,113,74,0.3)]">කට සෙල්ලම</h1>
              <p className="text-white/40 font-serif italic uppercase tracking-[0.4em] text-xs">Traditional Multiplayer Arena &bull; Digital Experience</p>
            </div>

            <div className="max-w-md mx-auto">
               {isJoiningMode ? (
                 /* Player Login (Only on join link) */
                 <div className="bg-black/30 p-10 rounded-[2.5rem] border border-white/5 space-y-8 text-white">
                    <div className="flex items-center gap-4 mb-4">
                       <div className="p-3 bg-terracotta/10 rounded-2xl text-terracotta">
                          <Users className="w-6 h-6" />
                       </div>
                       <h3 className="text-xl font-bold text-white">Join Arena as Player</h3>
                    </div>
                    <form onSubmit={handlePlayerLogin} className="space-y-6">
                       <div className="space-y-2">
                          <label className="text-[10px] uppercase tracking-widest text-stone-500 px-2">Display Name</label>
                          <input 
                             className="w-full bg-wood-dark/50 border border-white/5 rounded-2xl p-5 outline-none focus:border-terracotta text-xl font-light text-center transition-all text-white"
                             value={playerNameInput} onChange={e => setPlayerNameInput(e.target.value)} required placeholder="Your Name"
                          />
                       </div>
                       <button 
                          type="submit"
                          className="w-full bg-terracotta hover:bg-terracotta-dark text-black p-6 rounded-2xl font-black text-xl transition-all shadow-xl active:scale-[0.98] flex items-center justify-center gap-3"
                       >
                          Enter Arena <Swords className="w-5 h-5" />
                       </button>
                    </form>
                 </div>
               ) : (
                 /* Admin Login (Default) */
                 <div className="bg-black/30 p-10 rounded-[2.5rem] border border-white/5 space-y-8 text-white">
                    <div className="flex items-center gap-4 mb-4">
                       <div className="p-3 bg-amber-500/10 rounded-2xl text-amber-500">
                          <Crown className="w-6 h-6" />
                       </div>
                       <h3 className="text-xl font-bold text-white">House Administrator</h3>
                    </div>
                    <form onSubmit={handleAdminLogin} className="space-y-6">
                       <div className="space-y-2">
                          <label className="text-[10px] uppercase tracking-widest text-stone-500 px-2">Administrator Key</label>
                          <input 
                             type="password"
                             className="w-full bg-wood-dark/50 border border-white/5 rounded-2xl p-5 outline-none focus:border-amber-500 text-xl font-light text-center transition-all text-white"
                             value={adminPass} onChange={e => setAdminPass(e.target.value)} required placeholder="Admin Password"
                          />
                       </div>
                       <button 
                          type="submit"
                          className="w-full bg-amber-500 hover:bg-amber-600 text-black p-6 rounded-2xl font-black text-xl transition-all shadow-xl active:scale-[0.98]"
                       >
                          Open Dashboard
                       </button>
                    </form>
                 </div>
               )}
            </div>

            <div className="mt-16 text-center">
              <p className="text-[10px] uppercase tracking-widest text-stone-600">
                {isJoiningMode ? "Invited by Host" : "Direct access restricted to administrators"}
              </p>
            </div>
          </motion.div>
        )}

        {appMode === 'ADMIN' && (
           <AdminDashboard stats={adminStats} socket={socket} />
        )}

        {appMode === 'PLAYER' && (
          <motion.div 
            key="lobby"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full max-w-7xl flex flex-col items-center justify-center min-h-[calc(100vh-200px)] mt-24 mb-40 px-12 relative"
          >
            {/* Status Indicator */}
            <div className="mb-12 text-center">
              <h2 className="text-xs uppercase tracking-[0.5em] text-stone-500 font-sans mb-3">Arena Status</h2>
              <p className="text-5xl font-light italic text-white drop-shadow-sm">
                {gameState.status === 'WAITING' && `Lobby: ${gameState.slots.filter(s => s.playerId).length}/2 Connected`}
                {gameState.status === 'PLAYING' && `Match Underway`}
                {gameState.status === 'RESULT' && `Victory Declared`}
              </p>
              <div className="mt-6 flex justify-center gap-6">
                 <div className="bg-amber-500/10 border border-amber-500/20 px-6 py-2 rounded-full flex items-center gap-2">
                    <div className="text-left">
                       <span className="text-[10px] uppercase tracking-widest text-amber-500/60 font-bold block">Prize Pool</span>
                       <span className="text-xl font-sans text-gold font-bold flex items-center gap-2">
                          <Coins className="w-5 h-5" /> {gameState.totalPool}
                       </span>
                    </div>
                 </div>
                 <div className="bg-terracotta/10 border border-terracotta/20 px-6 py-2 rounded-full flex items-center gap-2">
                    <div className="text-left">
                       <span className="text-[10px] uppercase tracking-widest text-terracotta/60 font-bold block">Entry Fee</span>
                       <span className="text-xl font-sans text-stone-200 font-bold flex items-center gap-2">
                          <Coins className="w-5 h-5 text-stone-500" /> {gameState.currentEntryFee}
                       </span>
                    </div>
                 </div>
              </div>
            </div>

            {/* Players Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 w-full max-w-5xl items-center gap-20 px-12">
              {gameState.slots.map((slot, idx) => (
                <div key={idx} className="flex flex-col items-center gap-8 group">
                  <div className="text-center relative">
                    <h2 className="text-xs uppercase tracking-[0.3em] font-sans text-stone-600 mb-2">Slot {idx + 1}</h2>
                    <div className="flex items-center gap-3">
                       <p className={`text-3xl font-light italic italic transition-colors ${slot.playerId ? 'text-stone-100' : 'text-stone-800'}`}>
                         {slot.playerName || 'Vaccum...'}
                       </p>
                       {slot.playerId === myId && <span className="bg-terracotta px-2 py-0.5 rounded text-[8px] font-black uppercase text-black">You</span>}
                    </div>
                    {slot.playerId === gameState.winnerId && (
                      <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-gold animate-bounce">
                        <Crown className="w-8 h-8 drop-shadow-[0_0_15px_rgba(255,215,0,0.5)]" />
                      </div>
                    )}
                  </div>
                  
                  <div className="relative">
                    <KataPiece 
                       value={slot.roll ?? 0} 
                       isSpinning={gameState.spinningSlotIdx === idx} 
                       isHighlighted={
                         gameState.status === 'RESULT' 
                           ? (slot.playerId === gameState.winnerId || (gameState.winnerId === 'MULTIPLE' && slot.roll === Math.max(...gameState.slots.map(s => s.roll || 0))))
                           : (gameState.spinningSlotIdx === idx || (gameState.slots.findIndex(s => s.roll === null) === idx && gameState.spinningSlotIdx === null))
                       }
                       isWinner={slot.playerId === gameState.winnerId || (gameState.winnerId === 'MULTIPLE' && slot.roll === Math.max(...gameState.slots.map(s => s.roll || 0)))}
                    />
                    
                    {gameState.status === 'RESULT' && (
                      <motion.div 
                        initial={{ scale: 0 }} animate={{ scale: 1 }}
                        className={`absolute -bottom-6 px-6 py-2 text-xs uppercase font-sans font-black rounded-xl left-1/2 -translate-x-1/2 whitespace-nowrap border shadow-2xl ${
                        slot.playerId === gameState.winnerId || (gameState.winnerId === 'MULTIPLE' && slot.roll === Math.max(...gameState.slots.map(s => s.roll || 0)))
                          ? 'bg-gold text-black border-gold'
                          : 'bg-stone-900 text-stone-600 border-white/5'
                      }`}>
                        {slot.playerId === gameState.winnerId || (gameState.winnerId === 'MULTIPLE' && slot.roll === Math.max(...gameState.slots.map(s => s.roll || 0))) ? 'Champion' : 'Defeated'}
                      </motion.div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* --- ACTION AREA --- */}
            <div className="mt-20 flex flex-col items-center gap-12 w-full">
              <AnimatePresence mode="wait">
                {gameState.status === 'PLAYING' ? (
                  <motion.div key="roll" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center gap-6">
                    <div className="text-center mb-4">
                       <div className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-10 py-4 rounded-full uppercase text-xs tracking-[0.2em] font-sans font-black">
                          {gameState.spinningSlotIdx !== null 
                            ? `${gameState.slots[gameState.spinningSlotIdx].playerName} is rolling...` 
                            : (gameState.slots[gameState.slots.findIndex(s => s.roll === null)].playerId === myId)
                               ? 'Your Turn! Strike accurately.'
                               : `${gameState.slots.find(s => s.roll === null)?.playerName}'s Turn`}
                       </div>
                    </div>
                    {gameState.slots[gameState.slots.findIndex(s => s.roll === null)].playerId === myId && (
                       <button 
                        onClick={handleRoll}
                        disabled={gameState.spinningSlotIdx !== null}
                        className="group relative w-36 h-36 flex items-center justify-center transition-transform active:scale-95"
                      >
                         <div className="absolute inset-0 bg-terracotta rounded-full animate-ping opacity-10"></div>
                         <div className="absolute inset-0 bg-terracotta rounded-full animate-pulse opacity-20"></div>
                         <div className="absolute inset-4 border-2 border-dashed border-terracotta/40 rounded-full group-hover:rotate-45 transition-transform duration-1000"></div>
                         <div className="w-28 h-28 bg-terracotta hover:bg-terracotta-dark rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(200,113,74,0.4)] transition-all">
                           <span className="text-black font-sans font-black text-2xl tracking-tighter">
                             {gameState.spinningSlotIdx !== null ? '...' : 'HIT!'}
                           </span>
                         </div>
                       </button>
                    )}
                  </motion.div>
                ) : gameState.status === 'RESULT' ? (
                  <motion.div key="result" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex flex-col items-center gap-10 text-center">
                    <div className="space-y-4">
                      {gameState.winnerId === 'MULTIPLE' ? (
                        <div className="text-amber-400 text-6xl font-light italic">Equality of Strength</div>
                      ) : (
                        <div className="text-white text-6xl font-light italic">
                           {gameState.slots.find(s => s.playerId === gameState.winnerId)?.playerName} Claims Victory!
                        </div>
                      )}
                      <div className="flex justify-center flex-col items-center opacity-60">
                         <p className="text-stone-500 uppercase tracking-widest text-[10px]">
                            Pool: {gameState.totalPool} | Prize Pool: {gameState.winnerPrize}
                         </p>
                         {gameState.winnerId === 'MULTIPLE' && (
                           <p className="mt-4 text-terracotta text-xs uppercase tracking-[0.3em] animate-pulse font-black">
                              Stake for Rematch: 🪙 {gameState.currentEntryFee * 2}
                           </p>
                         )}
                      </div>
                    </div>
                    
                    <button 
                       onClick={handleReset} 
                       className="px-12 py-6 bg-white text-black rounded-2xl font-black text-xl hover:bg-stone-200 transition-all flex items-center gap-4 shadow-2xl active:scale-95"
                    >
                      <RotateCcw className="w-6 h-6" /> {gameState.winnerId === 'MULTIPLE' ? 'Double Stakes' : 'Next Battle'}
                    </button>
                  </motion.div>
                ) : gameState.status === 'WAITING' ? (
                  <motion.div key="waiting" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center gap-10">
                    <div className="text-center space-y-4">
                       <h3 className="text-3xl font-light italic text-white/40 uppercase tracking-[0.3em]">Stand By</h3>
                       <p className="text-stone-600 text-[10px] uppercase tracking-[0.5em] font-sans">Awaiting Challenger &bull; Stake: {gameState.currentEntryFee} 🪙</p>
                    </div>
                    
                    <div className="p-8 bg-black/20 border border-white/5 rounded-[2rem] flex items-center gap-8">
                       <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                       <p className="text-stone-500 text-xs italic">Waiting for enough players to strike the Kata.</p>
                    </div>

                    <p className="text-[10px] text-terracotta/40 uppercase tracking-widest font-black">Share the link with a friend to play!</p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- FOOTER --- */}
      {appMode !== 'AUTH' && (
        <motion.footer className="fixed bottom-0 left-0 w-full p-10 border-t border-white/5 bg-black/40 backdrop-blur-xl z-20">
           <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center text-stone-700 font-sans text-[10px] uppercase tracking-[0.4em] gap-6">
              <div className="flex gap-12">
                <div className="flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                  Synced
                </div>
                <div>Fee: 10%</div>
                <div>Stakes: {gameState.currentEntryFee} 🪙</div>
              </div>
              <div className="text-right">
                Sri Lankan Heritage Digital Arena &copy; 2024
              </div>
           </div>
        </motion.footer>
      )}
    </div>
  );
}

