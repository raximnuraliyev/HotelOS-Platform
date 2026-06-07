import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutGrid, Wrench, KeyRound, LogOut, CheckCircle2, AlertTriangle, Clock, Camera
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

interface MaintenanceIssue {
  id: number;
  room_number: number;
  guest_id: number | null;
  description: string;
  priority: number; // Critical=1, High=2, Normal=3, Low=4
  status: string; // Pending, Assigned, Resolved
  assigned_technician: string | null;
  created_at: string;
  started_at: string | null;
  resolved_at: string | null;
  before_photo: string | null;
  after_photo: string | null;
}

interface HotelEvent {
  event_id: string;
  timestamp: string;
  event_type: string;
  payload: any;
}

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

// Live timer component
function WorkTimer({ startedAt, resolvedAt }: { startedAt: string | null; resolvedAt: string | null }) {
  const [elapsed, setElapsed] = useState<string>('00:00');

  useEffect(() => {
    if (!startedAt) {
      setElapsed('Not Started');
      return;
    }

    if (resolvedAt) {
      const start = parseUtcDate(startedAt);
      const end = parseUtcDate(resolvedAt);
      const diffMs = Math.max(0, end - start);
      const diffSecs = Math.floor(diffMs / 1000);
      const mins = Math.floor(diffSecs / 60);
      const secs = diffSecs % 60;
      setElapsed(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      return;
    }

    const interval = setInterval(() => {
      const start = parseUtcDate(startedAt);
      const now = new Date().getTime();
      const diffMs = Math.max(0, now - start);
      const diffSecs = Math.floor(diffMs / 1000);
      const mins = Math.floor(diffSecs / 60);
      const secs = diffSecs % 60;
      setElapsed(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt, resolvedAt]);

  return <span className="font-mono text-rose-450 font-bold">{elapsed}</span>;
}

// Fixed preset mock photo (simple small svg in base64/data URI for demo)
const PRESET_RESOLVED_PHOTO = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23052e16'/><path d='M30 50 L45 65 L70 35' stroke='%2310b981' stroke-width='8' fill='none' stroke-linecap='round' stroke-linejoin='round'/><text x='50' y='85' fill='%2310b981' font-size='10' font-family='sans-serif' text-anchor='middle' font-weight='bold'>FIXED / RESOLVED</text></svg>";

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('maint_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // States
  const [rooms, setRooms] = useState<Room[]>([]);
  const [issues, setIssues] = useState<MaintenanceIssue[]>([]);
  const [techName, setTechName] = useState('');
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [maintMsg, setMaintMsg] = useState({ type: '', text: '' });

  // Resolve upload states
  const [resolvingIssueId, setResolvingIssueId] = useState<number | null>(null);
  const [afterPhoto, setAfterPhoto] = useState<string>('');

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
        if (data.staff_role !== 'maintenance' && data.staff_role !== 'super_admin') {
          setLoginError('Access denied: Maintenance dashboard requires Maintenance or Super Admin privileges.');
          return;
        }
        localStorage.setItem('maint_token', data.access_token);
        localStorage.setItem('maint_role', data.staff_role);
        localStorage.setItem('maint_username', data.username);
        setToken(data.access_token);
        setTechName(data.username);
      } else {
        const err = await res.json();
        setLoginError(formatErrorDetail(err.detail) || 'Authentication failed.');
      }
    } catch (e) {
      setLoginError('Unable to connect to Reception Service.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('maint_token');
    localStorage.removeItem('maint_role');
    localStorage.removeItem('maint_username');
    setToken(null);
    if (wsRef.current) wsRef.current.close();
  };

  const fetchData = async () => {
    if (!token) return;
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      const resRooms = await fetch('http://localhost:8001/api/reception/rooms');
      if (resRooms.ok) setRooms(await resRooms.json());

      const resIssues = await fetch('http://localhost:8004/api/maintenance/issues', { headers });
      if (resIssues.status === 401 || resIssues.status === 403) {
        handleLogout();
        return;
      }
      if (resIssues.ok) setIssues(await resIssues.json());
    } catch (e) {
      console.error('Error fetching data:', e);
    }
  };

  // Resolve issue handler
  const handleResolveIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingIssueId) return;
    setMaintMsg({ type: '', text: '' });
    
    // Require after photo
    const photoToUse = afterPhoto || PRESET_RESOLVED_PHOTO;
    
    try {
      const res = await fetch(`http://localhost:8004/api/maintenance/issues/${resolvingIssueId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          after_photo: photoToUse
        })
      });
      if (res.ok) {
        setMaintMsg({ type: 'success', text: `Issue #${resolvingIssueId} marked resolved.` });
        setResolvingIssueId(null);
        setAfterPhoto('');
        fetchData();
      } else {
        const err = await res.json();
        setMaintMsg({ type: 'error', text: formatErrorDetail(err.detail) || 'Failed to resolve issue.' });
      }
    } catch (e) {
      setMaintMsg({ type: 'error', text: 'Error connecting to Maintenance service.' });
    }
  };

  // Convert uploaded file to base64
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAfterPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Websocket listeners
  useEffect(() => {
    if (!token) return;
    setTechName(localStorage.getItem('maint_username') || 'Maintenance');
    fetchData();

    setWsStatus('connecting');
    const ws = new WebSocket(`ws://localhost:8005/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onmessage = (event) => {
      try {
        const data: HotelEvent = JSON.parse(event.data);
        if (data.event_type.startsWith('room.status_changed') || data.event_type.startsWith('maintenance.')) {
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
            <h1 className="heading-font font-bold text-2xl text-slate-100">Maintenance Portal</h1>
            <p className="text-slate-400 text-sm">Hotel Operations Maintenance Team Credentials Only</p>
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
                placeholder="tech1"
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
              Login to Maintenance
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Find rooms under maintenance or containing active tickets
  const activeTickets = issues.filter(t => t.status !== 'Resolved');
  const activeTicketRooms = activeTickets.map(t => t.room_number);
  const maintenanceRooms = rooms.filter(r => r.status === 'Maintenance' || activeTicketRooms.includes(r.room_number));

  const priorityLabels: {[key: number]: {name: string, class: string}} = {
    1: { name: 'Critical', class: 'bg-rose-500/10 border-rose-500/25 text-rose-450' },
    2: { name: 'High', class: 'bg-orange-500/10 border-orange-500/25 text-orange-400' },
    3: { name: 'Normal', class: 'bg-cyan-500/10 border-cyan-500/25 text-cyan-400' },
    4: { name: 'Low', class: 'bg-slate-500/10 border-slate-500/25 text-slate-400' }
  };

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 flex flex-col justify-between selection:bg-cyan-500/30">
      
      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-950/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-650 flex items-center justify-center">
              <span className="heading-font font-bold text-sm text-slate-950">H</span>
            </div>
            <span className="heading-font font-bold text-lg tracking-wider">HotelOS <span className="text-xs text-cyan-400 font-normal border border-cyan-800 px-2 py-0.5 rounded-full ml-2">Maintenance Dashboard</span></span>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <span className="text-slate-400 text-xs hidden sm:inline">User: <strong className="text-slate-200">{techName}</strong></span>
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
        
        {/* Left Column: Maintenance-Focus Room Grid */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-slate-900/40 border border-slate-800/80 shadow-xl shadow-slate-950/20 p-6 rounded-2xl">
            <h2 className="heading-font font-bold text-lg mb-2 flex items-center gap-2">
              <LayoutGrid size={18} className="text-cyan-500" />
              Maintenance Room Grid
            </h2>
            <p className="text-xs text-slate-400 mb-4 italic">Displaying only rooms undergoing maintenance or having open tickets.</p>
            
            {maintenanceRooms.length === 0 ? (
              <div className="text-slate-500 text-center py-12 italic text-sm border border-dashed border-slate-850 rounded-xl">
                No rooms currently require maintenance focus. All systems functional!
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {maintenanceRooms.map((room) => {
                  const roomIssues = activeTickets.filter(i => i.room_number === room.room_number);
                  return (
                    <div 
                      key={room.room_number}
                      className={`border p-4 rounded-xl flex flex-col gap-2 transition-all relative overflow-hidden bg-rose-950/10 border-rose-500/20`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="heading-font font-extrabold text-slate-100">Room {room.room_number}</span>
                        <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-rose-500/35 bg-rose-500/10 text-rose-450`}>
                          {room.status === 'Maintenance' ? 'Out of Order' : 'Fix Needed'}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1 text-[10px]">
                        <span className="text-slate-400 font-semibold">{room.room_type} (Flr {room.floor})</span>
                        <div className="flex flex-col gap-1 border-t border-slate-900/60 pt-1.5 mt-1">
                          <span className="text-slate-500 font-semibold">Active Issues ({roomIssues.length}):</span>
                          {roomIssues.map(issue => (
                            <span key={issue.id} className="text-slate-300 truncate">
                              • {issue.description}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Work Queue & Ticket Actions */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <section className="bg-slate-900/40 border border-slate-800/80 shadow-xl shadow-slate-950/20 p-6 rounded-2xl">
            <h3 className="heading-font font-bold text-lg mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
              <Wrench size={18} className="text-cyan-500" />
              Urgent Work Orders (Priority Queue)
            </h3>

            {maintMsg.text && (
              <div className={`text-xs p-3 rounded-xl border mb-4 ${
                maintMsg.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-rose-950/40 border-rose-800/50 text-rose-300'
              }`}>
                {maintMsg.text}
              </div>
            )}

            <div className="flex flex-col gap-4 max-h-[480px] overflow-y-auto pr-1">
              {activeTickets.length === 0 ? (
                <div className="text-slate-500 text-center py-12 italic text-sm">No pending maintenance issues. Perfect score!</div>
              ) : (
                activeTickets.map((issue) => (
                  <div key={issue.id} className="bg-slate-950 border border-slate-850 p-4.5 rounded-xl flex flex-col gap-4">
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2.5">
                          <span className="heading-font font-extrabold text-slate-200">Room {issue.room_number}</span>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${
                            priorityLabels[issue.priority]?.class || ''
                          }`}>
                            {priorityLabels[issue.priority]?.name || 'Normal'}
                          </span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                            issue.status === 'Pending' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                          }`}>
                            {issue.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 bg-slate-900/30 p-2 rounded border border-slate-900 leading-relaxed">
                          {issue.description}
                        </p>
                      </div>

                      {issue.status === 'Assigned' && (
                        <div className="text-[10px] text-slate-400 flex flex-col items-end gap-1.5 shrink-0">
                          <span className="bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-[9px] text-slate-400">Assigned: {issue.assigned_technician}</span>
                          <span className="flex items-center gap-1">
                            <Clock size={11} className="text-rose-400" />
                            <WorkTimer startedAt={issue.started_at} resolvedAt={issue.resolved_at} />
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Image uploads / display section */}
                    <div className="flex flex-col gap-3.5 border-t border-slate-900 pt-3">
                      <div className="grid grid-cols-2 gap-4">
                        {/* Before photo */}
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Before Photo</span>
                          {issue.before_photo ? (
                            <img src={issue.before_photo} className="w-24 h-24 object-cover rounded-lg border border-slate-800 shadow-md bg-slate-950" alt="Issue before" />
                          ) : (
                            <span className="text-[10px] text-slate-600 italic">No photo attached by guest</span>
                          )}
                        </div>

                        {/* Actions */}
                        {issue.status === 'Assigned' && (
                          <div className="flex flex-col gap-2 justify-end">
                            {resolvingIssueId !== issue.id ? (
                              <button
                                onClick={() => {
                                  setResolvingIssueId(issue.id);
                                  setAfterPhoto('');
                                }}
                                className="w-full py-2 bg-gradient-to-r from-cyan-500 to-indigo-650 hover:opacity-90 text-slate-950 text-xs font-bold rounded-lg cursor-pointer transition-all shadow-md shadow-cyan-500/10"
                              >
                                Resolve Issue
                              </button>
                            ) : (
                              <button
                                onClick={() => setResolvingIssueId(null)}
                                className="w-full py-2 bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-bold rounded-lg cursor-pointer transition-all"
                              >
                                Cancel Resolve
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Resolving action drawer */}
                      {resolvingIssueId === issue.id && (
                        <form onSubmit={handleResolveIssue} className="flex flex-col gap-3.5 bg-slate-900/40 p-4 rounded-xl border border-slate-850 mt-1">
                          <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                            <Camera size={13} className="text-cyan-500" />
                            Submit Resolution Photo (Required)
                          </h4>

                          <div className="flex flex-col sm:flex-row items-center gap-4">
                            <div className="flex flex-col gap-1 w-full">
                              <label className="text-[9px] text-slate-400 font-bold uppercase">Upload After Photo</label>
                              <input 
                                type="file" 
                                accept="image/*" 
                                onChange={handlePhotoUpload}
                                className="bg-slate-950 border border-slate-850 text-[10px] rounded-lg p-2 text-slate-350 w-full"
                              />
                            </div>
                            <div className="shrink-0 flex flex-col items-center gap-1">
                              <span className="text-[9px] text-slate-500 font-bold uppercase">Preview</span>
                              {afterPhoto ? (
                                <img src={afterPhoto} className="w-14 h-14 object-cover rounded-lg border border-slate-800" alt="After preview" />
                              ) : (
                                <div className="w-14 h-14 rounded-lg bg-slate-950 border border-slate-850 flex items-center justify-center text-slate-600 text-[10px] italic">Empty</div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setAfterPhoto(PRESET_RESOLVED_PHOTO)}
                              className="px-3 py-1.5 bg-slate-850 border border-slate-800 hover:border-slate-750 text-slate-300 text-[10px] font-semibold rounded-lg cursor-pointer transition-all"
                            >
                              Use Fixed Preset Mock
                            </button>
                            <button
                              type="submit"
                              className="px-4 py-1.5 bg-emerald-500 text-slate-950 hover:bg-emerald-400 text-[10px] font-bold rounded-lg cursor-pointer transition-all shadow-md shadow-emerald-500/10 flex-grow"
                            >
                              Submit Resolution & Close Ticket
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Recently Resolved Tickets */}
            {issues.filter(t => t.status === 'Resolved').length > 0 && (
              <div className="mt-6 border-t border-slate-900 pt-4">
                <h4 className="heading-font font-semibold text-xs text-slate-400 uppercase tracking-wider mb-2.5">Recently Resolved Tickets</h4>
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {issues.filter(t => t.status === 'Resolved').slice(-5).map((issue) => (
                    <div key={issue.id} className="bg-slate-950/40 border border-slate-900/60 p-3.5 rounded-lg flex flex-col gap-2 text-xs text-slate-400">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-slate-300">Room {issue.room_number}</span> resolved by {issue.assigned_technician}
                        </div>
                        <span className="text-[10px] text-slate-500 flex items-center gap-1.5">
                          Duration: <WorkTimer startedAt={issue.started_at} resolvedAt={issue.resolved_at} />
                          <CheckCircle2 size={12} className="text-emerald-500" />
                        </span>
                      </div>
                      <div className="flex gap-4 items-center">
                        {issue.before_photo && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[8px] text-slate-600 font-bold uppercase">Before</span>
                            <img src={issue.before_photo} className="w-10 h-10 object-cover rounded border border-slate-900" alt="Before" />
                          </div>
                        )}
                        {issue.after_photo && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[8px] text-slate-600 font-bold uppercase">After</span>
                            <img src={issue.after_photo} className="w-10 h-10 object-cover rounded border border-slate-900" alt="After" />
                          </div>
                        )}
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
        <p>© 2026 HotelOS Maintenance. Maintenance Portal. All Rights Reserved.</p>
      </footer>

    </div>
  );
}

export default App;
