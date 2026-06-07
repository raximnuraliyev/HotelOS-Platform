import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutGrid, ClipboardCheck, KeyRound, LogOut, CheckCircle2, AlertTriangle, Play
} from 'lucide-react';

interface Room {
  room_number: number;
  room_type: string;
  floor: number;
  status: string;
  nightly_rate: number;
  clean_since: string;
  near_elevator: boolean;
  near_stairs: boolean;
}

interface HousekeepingTask {
  id: number;
  room_number: number;
  status: string;
  assigned_housekeeper: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface HotelEvent {
  event_id: string;
  timestamp: string;
  event_type: string;
  payload: any;
}

// Helper to format error messages
const formatErrorDetail = (detail: any): string => {
  if (!detail) return 'An unknown error occurred.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(d => {
      const field = Array.isArray(d.loc) ? d.loc.slice(1).join('.') : '';
      return `${field ? field + ': ' : ''}${d.msg}`;
    }).join(', ');
  }
  return JSON.stringify(detail);
};

// Helper to parse dates as UTC if they lack timezone info
const parseUtcDate = (dateStr: string | null): number => {
  if (!dateStr) return 0;
  let cleanStr = dateStr;
  if (!cleanStr.endsWith('Z') && !cleanStr.includes('+') && !cleanStr.includes('-')) {
    cleanStr = cleanStr + 'Z';
  }
  return new Date(cleanStr).getTime();
};

// Live cleaning timer component
function CleaningTimer({ startedAt, completedAt }: { startedAt: string | null; completedAt: string | null }) {
  const [elapsed, setElapsed] = useState<string>('00:00');

  useEffect(() => {
    if (!startedAt) {
      setElapsed('Not Started');
      return;
    }

    if (completedAt) {
      const start = parseUtcDate(startedAt);
      const end = parseUtcDate(completedAt);
      const diffMs = Math.max(0, end - start);
      const diffSecs = Math.floor(diffMs / 1000);
      const totalMins = Math.floor(diffSecs / 60);
      const mins = Math.min(60, totalMins);
      const secs = mins === 60 ? 0 : diffSecs % 60;
      setElapsed(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      return;
    }

    const interval = setInterval(() => {
      const start = parseUtcDate(startedAt);
      const now = new Date().getTime();
      const diffMs = Math.max(0, now - start);
      const diffSecs = Math.floor(diffMs / 1000);
      const totalMins = Math.floor(diffSecs / 60);
      const mins = Math.min(60, totalMins);
      const secs = mins === 60 ? 0 : diffSecs % 60;
      setElapsed(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt, completedAt]);

  return <span className="font-mono text-cyan-400 font-bold">{elapsed}</span>;
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('house_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // States
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tasks, setTasks] = useState<HousekeepingTask[]>([]);
  const [housekeeperName, setHousekeeperName] = useState('');
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [taskMsg, setTaskMsg] = useState({ type: '', text: '' });

  const wsRef = useRef<WebSocket | null>(null);

  // Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('http://localhost:8001/api/reception/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.staff_role !== 'housekeeper' && data.staff_role !== 'super_admin') {
          setLoginError('Access denied: Housekeeper dashboard requires Housekeeper or Super Admin privileges.');
          return;
        }
        localStorage.setItem('house_token', data.access_token);
        localStorage.setItem('house_role', data.staff_role);
        localStorage.setItem('house_username', data.username);
        setToken(data.access_token);
        setHousekeeperName(data.username);
      } else {
        const err = await res.json();
        setLoginError(formatErrorDetail(err.detail) || 'Authentication failed.');
      }
    } catch (e) {
      setLoginError('Unable to connect to Reception Service.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('house_token');
    localStorage.removeItem('house_role');
    localStorage.removeItem('house_username');
    setToken(null);
    if (wsRef.current) wsRef.current.close();
  };

  const fetchData = async () => {
    if (!token) return;
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      const resRooms = await fetch('http://localhost:8001/api/reception/rooms');
      if (resRooms.ok) setRooms(await resRooms.json());

      const resTasks = await fetch('http://localhost:8002/api/housekeeping/tasks', { headers });
      if (resTasks.status === 401 || resTasks.status === 403) {
        handleLogout();
        return;
      }
      if (resTasks.ok) setTasks(await resTasks.json());
    } catch (e) {
      console.error('Error fetching data:', e);
    }
  };

  const handleStartTask = async (taskId: number) => {
    setTaskMsg({ type: '', text: '' });
    const nameToUse = housekeeperName || localStorage.getItem('house_username') || 'Housekeeper';
    try {
      const res = await fetch(`http://localhost:8002/api/housekeeping/tasks/${taskId}/start?housekeeper=${encodeURIComponent(nameToUse)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setTaskMsg({ type: 'success', text: `Cleaning started for task #${taskId}.` });
        fetchData();
      } else {
        const err = await res.json();
        setTaskMsg({ type: 'error', text: formatErrorDetail(err.detail) || 'Failed to start cleaning.' });
      }
    } catch (e) {
      setTaskMsg({ type: 'error', text: 'Error connecting to Housekeeping service.' });
    }
  };

  const handleCompleteTask = async (taskId: number) => {
    setTaskMsg({ type: '', text: '' });
    try {
      const res = await fetch(`http://localhost:8002/api/housekeeping/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setTaskMsg({ type: 'success', text: `Cleaning completed for task #${taskId}.` });
        fetchData();
      } else {
        const err = await res.json();
        setTaskMsg({ type: 'error', text: formatErrorDetail(err.detail) || 'Failed to complete cleaning.' });
      }
    } catch (e) {
      setTaskMsg({ type: 'error', text: 'Error connecting to Housekeeping service.' });
    }
  };

  // Websocket listeners
  useEffect(() => {
    if (!token) return;
    setHousekeeperName(localStorage.getItem('house_username') || 'Housekeeper');
    fetchData();

    setWsStatus('connecting');
    const ws = new WebSocket(`ws://localhost:8005/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onmessage = (event) => {
      try {
        const data: HotelEvent = JSON.parse(event.data);
        if (data.event_type.startsWith('room.status_changed') || data.event_type.startsWith('room.cleaning_started') || data.event_type.startsWith('room.cleaned') || data.event_type.startsWith('room.vacated')) {
          fetchData();
        }
      } catch (err) {
        console.error(err);
      }
    };
    ws.onclose = () => setWsStatus('disconnected');

    return () => {
      ws.close();
    };
  }, [token]);

  if (!token) {
    return (
      <div className="min-h-screen bg-[#070b13] flex items-center justify-center relative p-6">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="w-full max-w-md bg-slate-900/40 border border-slate-800/80 shadow-xl shadow-slate-950/20 rounded-3xl p-8 backdrop-blur-xl relative z-10 flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-650 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <span className="heading-font font-bold text-xl text-slate-950">H</span>
            </div>
            <h1 className="heading-font font-bold text-2xl text-slate-100">Housekeeper Portal</h1>
            <p className="text-slate-400 text-sm">Hotel Operations Housekeeping Team Credentials Only</p>
          </div>

          {loginError && (
            <div className="bg-rose-950/40 border border-rose-800/50 text-rose-300 text-sm p-4 rounded-xl flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Username</label>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="house1"
                required
                className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 text-slate-200"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Password</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 text-slate-200"
              />
            </div>

            <button 
              type="submit"
              className="mt-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-650 text-slate-950 font-bold heading-font flex items-center justify-center gap-2 hover:opacity-90 transition-all cursor-pointer shadow-lg shadow-cyan-500/10"
            >
              <KeyRound size={16} />
              Login to Housekeeping
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Filter rooms to Clean, Dirty, Being Cleaned
  const housekeepingRooms = rooms.filter(r => r.status === 'Clean' || r.status === 'Dirty' || r.status === 'Being Cleaned');

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 flex flex-col justify-between selection:bg-cyan-500/30">
      
      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-950/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-650 flex items-center justify-center">
              <span className="heading-font font-bold text-sm text-slate-950">H</span>
            </div>
            <span className="heading-font font-bold text-lg tracking-wider">HotelOS <span className="text-xs text-cyan-400 font-normal border border-cyan-800 px-2 py-0.5 rounded-full ml-2">Housekeeper Dashboard</span></span>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <span className="text-slate-400 text-xs hidden sm:inline">User: <strong className="text-slate-200">{housekeeperName}</strong></span>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${wsStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-slate-400 text-xs hidden sm:inline uppercase tracking-wider">{wsStatus === 'connected' ? 'Live gateway linked' : 'gateway offline'}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-xs cursor-pointer text-slate-350 transition-all"
            >
              <LogOut size={12} /> Log Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8 flex-grow w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Housekeeping Rooms Grid */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <div className="bg-slate-900/40 border border-slate-800/80 shadow-xl shadow-slate-950/20 p-6 rounded-2xl">
            <h2 className="heading-font font-bold text-lg mb-2 flex items-center gap-2">
              <LayoutGrid size={18} className="text-cyan-500" />
              Housekeeping Room Grid
            </h2>
            <p className="text-xs text-slate-400 mb-4 italic">Note: Occupant information is hidden to respect guest privacy.</p>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {housekeepingRooms.map((room) => (
                <div 
                  key={room.room_number}
                  className={`border p-4.5 rounded-xl transition-all duration-300 relative overflow-hidden flex flex-col gap-2 ${
                    room.status === 'Clean' ? 'bg-emerald-950/10 border-emerald-500/20' :
                    room.status === 'Dirty' ? 'bg-amber-950/10 border-amber-500/20' :
                    'bg-indigo-950/10 border-indigo-500/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="heading-font font-extrabold text-slate-100">{room.room_number}</span>
                    <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${
                      room.status === 'Clean' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                      room.status === 'Dirty' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                      'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                    }`}>
                      {room.status}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5 text-[10px]">
                    <span className="text-slate-400 font-semibold">{room.room_type} (Flr {room.floor})</span>
                    <span className="text-slate-500">
                      Clean since: {room.clean_since ? new Date(room.clean_since).toLocaleTimeString() : 'N/A'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Housekeeping Task Queue */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <section className="bg-slate-900/40 border border-slate-800/80 shadow-xl shadow-slate-950/20 p-6 rounded-2xl">
            <h3 className="heading-font font-bold text-lg mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
              <ClipboardCheck size={18} className="text-cyan-500" />
              Active Cleaning Queue
            </h3>

            {taskMsg.text && (
              <div className={`text-xs p-3 rounded-xl border mb-4 ${
                taskMsg.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-rose-950/40 border-rose-800/50 text-rose-300'
              }`}>
                {taskMsg.text}
              </div>
            )}

            <div className="flex flex-col gap-4 max-h-[500px] overflow-y-auto pr-1">
              {tasks.filter(t => t.status !== 'Finished').length === 0 ? (
                <div className="text-slate-500 text-center py-12 italic text-sm">No active cleaning tasks. Nice job!</div>
              ) : (
                tasks.filter(t => t.status !== 'Finished').map((task) => (
                  <div key={task.id} className="bg-slate-950 border border-slate-850 p-4 rounded-xl flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="heading-font font-bold text-slate-200">Room {task.room_number}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                          task.status === 'Pending' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                          'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                        }`}>
                          {task.status}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 flex flex-col gap-0.5">
                        <span>Created: {new Date(task.created_at).toLocaleTimeString()}</span>
                        {task.started_at && (
                          <span className="flex items-center gap-1">
                            Timer: <CleaningTimer startedAt={task.started_at} completedAt={task.completed_at} />
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {task.status === 'Pending' ? (
                        <button
                          onClick={() => handleStartTask(task.id)}
                          className="px-3 py-1.5 bg-gradient-to-r from-cyan-500 to-indigo-650 hover:opacity-90 text-slate-950 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition-all shadow-md shadow-cyan-500/10"
                        >
                          <Play size={12} /> Start Cleaning
                        </button>
                      ) : (
                        <button
                          onClick={() => handleCompleteTask(task.id)}
                          className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold cursor-pointer transition-all"
                        >
                          Mark Finished
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Recently Finished Tasks */}
            {tasks.filter(t => t.status === 'Finished').length > 0 && (
              <div className="mt-6 border-t border-slate-900 pt-4">
                <h4 className="heading-font font-semibold text-xs text-slate-400 uppercase tracking-wider mb-2.5">Recently Completed Tasks</h4>
                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                  {tasks.filter(t => t.status === 'Finished').slice(-5).map((task) => (
                    <div key={task.id} className="bg-slate-950/40 border border-slate-900/60 p-3 rounded-lg flex items-center justify-between text-xs text-slate-400">
                      <div>
                        <span className="font-semibold text-slate-300">Room {task.room_number}</span> by {task.assigned_housekeeper}
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-2">
                        <span>Duration: <CleaningTimer startedAt={task.started_at} completedAt={task.completed_at} /></span>
                        <CheckCircle2 size={12} className="text-emerald-500" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-950 bg-slate-950 py-4 text-center text-xs text-slate-600">
        <p>© 2026 HotelOS Housekeeping. Housekeeper Portal. All Rights Reserved.</p>
      </footer>

    </div>
  );
}

export default App;
