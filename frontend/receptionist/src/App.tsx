import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutGrid, Users, KeyRound, LogOut, AlertTriangle
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

interface Guest {
  id: number;
  name: string;
  reservation_code: string;
  room_number: number | null;
  status: string;
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

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('recep_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // States
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  // Form states
  const [checkInName, setCheckInName] = useState('');
  const [checkInType, setCheckInType] = useState('Single');
  const [checkInFloor, setCheckInFloor] = useState<number | null>(null);
  const [checkInProximity, setCheckInProximity] = useState('None');
  const [checkInNights, setCheckInNights] = useState(1);
  const [checkInMsg, setCheckInMsg] = useState({ type: '', text: '' });
  
  const [checkoutRoom, setCheckoutRoom] = useState<number | null>(null);
  const [checkoutMinibar, setCheckoutMinibar] = useState(0);
  const [checkoutLateHours, setCheckoutLateHours] = useState(0);
  const [checkoutDiscountType, setCheckoutDiscountType] = useState('none');
  const [checkoutDiscountVal, setCheckoutDiscountVal] = useState(0);
  const [checkoutPreview, setCheckoutPreview] = useState<any>(null);
  const [checkoutMsg, setCheckoutMsg] = useState({ type: '', text: '' });

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
        if (data.staff_role !== 'receptionist' && data.staff_role !== 'super_admin') {
          setLoginError('Access denied: Receptionist dashboard requires Receptionist or Super Admin privileges.');
          return;
        }
        localStorage.setItem('recep_token', data.access_token);
        localStorage.setItem('recep_role', data.staff_role);
        setToken(data.access_token);
      } else {
        const err = await res.json();
        setLoginError(formatErrorDetail(err.detail) || 'Authentication failed.');
      }
    } catch (e) {
      setLoginError('Unable to connect to Reception Service.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('recep_token');
    localStorage.removeItem('recep_role');
    setToken(null);
    if (wsRef.current) wsRef.current.close();
  };

  const fetchData = async () => {
    try {
      const resRooms = await fetch('http://localhost:8001/api/reception/rooms');
      if (resRooms.ok) setRooms(await resRooms.json());
      const resGuests = await fetch('http://localhost:8001/api/reception/guests');
      if (resGuests.ok) setGuests(await resGuests.json());
    } catch (e) {
      console.error('Error fetching data:', e);
    }
  };

  const updateCheckoutPreview = async () => {
    if (!checkoutRoom) {
      setCheckoutPreview(null);
      return;
    }
    try {
      const res = await fetch(
        `http://localhost:8001/api/reception/checkout/preview?room_number=${checkoutRoom}&late_checkout_hours=${checkoutLateHours}&minibar_charges=${checkoutMinibar}&discount_type=${checkoutDiscountType}&discount_value=${checkoutDiscountVal}`
      );
      if (res.ok) {
        setCheckoutPreview(await res.json());
      } else {
        setCheckoutPreview(null);
      }
    } catch (e) {
      console.error(e);
      setCheckoutPreview(null);
    }
  };

  useEffect(() => {
    updateCheckoutPreview();
  }, [checkoutRoom, checkoutLateHours, checkoutMinibar, checkoutDiscountType, checkoutDiscountVal]);

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckInMsg({ type: '', text: '' });
    try {
      const res = await fetch('http://localhost:8001/api/reception/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          guest_name: checkInName,
          room_type: checkInType,
          floor_preference: checkInFloor,
          proximity_preference: checkInProximity === 'None' ? null : checkInProximity,
          nights: checkInNights
        })
      });
      if (res.ok) {
        const data = await res.json();
        setCheckInMsg({
          type: 'success',
          text: `Checked in successfully! Assigned Room ${data.room_number}. Code: ${data.guest.reservation_code}`
        });
        setCheckInName('');
        setCheckInNights(1);
        fetchData();
      } else {
        const err = await res.json();
        setCheckInMsg({ type: 'error', text: formatErrorDetail(err.detail) || 'Check-in failed.' });
        if (res.status === 401 || res.status === 403) {
          handleLogout();
        }
      }
    } catch (e) {
      setCheckInMsg({ type: 'error', text: 'Error connecting to Reception service.' });
    }
  };

  const handleCheckOut = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutMsg({ type: '', text: '' });
    if (!checkoutRoom) return;
    try {
      const res = await fetch('http://localhost:8001/api/reception/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          room_number: checkoutRoom,
          late_checkout_hours: checkoutLateHours,
          minibar_charges: checkoutMinibar,
          discount_type: checkoutDiscountType,
          discount_value: checkoutDiscountVal
        })
      });
      if (res.ok) {
        setCheckoutMsg({ type: 'success', text: `Room ${checkoutRoom} checked out successfully.` });
        setCheckoutRoom(null);
        setCheckoutMinibar(0);
        setCheckoutLateHours(0);
        setCheckoutPreview(null);
        fetchData();
      } else {
        const err = await res.json();
        setCheckoutMsg({ type: 'error', text: formatErrorDetail(err.detail) || 'Checkout failed.' });
        if (res.status === 401 || res.status === 403) {
          handleLogout();
        }
      }
    } catch (e) {
      setCheckoutMsg({ type: 'error', text: 'Error connecting to Reception service.' });
    }
  };

  // Websocket listeners
  useEffect(() => {
    if (!token) return;
    fetchData();

    setWsStatus('connecting');
    const ws = new WebSocket(`ws://localhost:8005/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onmessage = (event) => {
      try {
        const data: HotelEvent = JSON.parse(event.data);
        if (data.event_type.startsWith('room.status_changed') || data.event_type.startsWith('guest.')) {
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
            <h1 className="heading-font font-bold text-2xl text-slate-100">Receptionist Portal</h1>
            <p className="text-slate-400 text-sm">Hotel Operations Frontdesk Credentials Only</p>
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
                placeholder="recep1"
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
              Login to Frontdesk
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 flex flex-col justify-between selection:bg-cyan-500/30">
      
      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-950/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-650 flex items-center justify-center">
              <span className="heading-font font-bold text-sm text-slate-950">H</span>
            </div>
            <span className="heading-font font-bold text-lg tracking-wider">HotelOS <span className="text-xs text-cyan-400 font-normal border border-cyan-800 px-2 py-0.5 rounded-full ml-2">Receptionist Dashboard</span></span>
          </div>

          <div className="flex items-center gap-6 text-sm">
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
        
        {/* Left Column: Room Grid */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="bg-slate-900/40 border border-slate-800/80 shadow-xl shadow-slate-950/20 p-6 rounded-2xl">
            <h2 className="heading-font font-bold text-lg mb-4 flex items-center gap-2">
              <LayoutGrid size={18} className="text-cyan-500" />
              Interactive Room Grid
            </h2>
            
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {rooms.map((room) => {
                const guestInRoom = guests.find(g => g.room_number === room.room_number && g.status === 'CheckedIn');
                return (
                  <div 
                    key={room.room_number}
                    onClick={() => {
                      if (room.status === 'Occupied') {
                        setCheckoutRoom(room.room_number);
                      }
                    }}
                    className={`border p-4.5 rounded-xl transition-all duration-300 relative overflow-hidden cursor-pointer flex flex-col gap-3 hover:scale-[1.03] hover:shadow-lg ${
                      room.status === 'Clean' ? 'bg-emerald-950/10 border-emerald-500/20 hover:border-emerald-500/50 hover:shadow-emerald-500/5' :
                      room.status === 'Occupied' ? 'bg-cyan-950/10 border-cyan-500/30 hover:border-cyan-500/60 hover:shadow-cyan-500/5' :
                      room.status === 'Dirty' ? 'bg-amber-950/10 border-amber-500/20 hover:border-amber-500/50 hover:shadow-amber-500/5' :
                      room.status === 'Being Cleaned' ? 'bg-indigo-950/10 border-indigo-500/20 hover:border-indigo-500/50 hover:shadow-indigo-500/5' :
                      'bg-rose-950/10 border-rose-500/20 hover:border-rose-500/50 hover:shadow-rose-500/5'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="heading-font font-extrabold text-slate-100">{room.room_number}</span>
                      <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${
                        room.status === 'Clean' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                        room.status === 'Occupied' ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' :
                        room.status === 'Dirty' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                        room.status === 'Being Cleaned' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' :
                        'bg-rose-500/10 border-rose-500/20 text-rose-400'
                      }`}>
                        {room.status}
                      </span>
                    </div>

                    <div className="flex flex-col gap-0.5 text-[10px]">
                      <span className="text-slate-400 font-semibold">{room.room_type} (Flr {room.floor})</span>
                      <span className="text-slate-500">${room.nightly_rate}/night</span>
                    </div>

                    <div className="border-t border-slate-900/60 pt-2 flex flex-col gap-1 text-[10px]">
                      {guestInRoom ? (
                        <>
                          <span className="text-cyan-400 font-bold truncate">{guestInRoom.name}</span>
                          <span className="text-slate-500 font-mono text-[9px]">{guestInRoom.reservation_code}</span>
                        </>
                      ) : (
                        <span className="text-slate-600 italic">No Active Guest</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Check-In and Check-Out Forms */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Check-In */}
          <section className="bg-slate-900/40 border border-slate-800/80 shadow-xl shadow-slate-950/20 p-6 rounded-2xl">
            <h3 className="heading-font font-bold text-lg mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
              <Users size={18} className="text-cyan-500" />
              Guest Check-In
            </h3>

            {checkInMsg.text && (
              <div className={`text-xs p-3 rounded-xl border mb-4 ${
                checkInMsg.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-rose-950/40 border-rose-800/50 text-rose-300'
              }`}>
                {checkInMsg.text}
              </div>
            )}

            <form onSubmit={handleCheckIn} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase">Guest Name</label>
                <input 
                  type="text" 
                  value={checkInName}
                  onChange={(e) => setCheckInName(e.target.value)}
                  placeholder="e.g. John Doe"
                  required
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Room Type</label>
                  <select 
                    value={checkInType} 
                    onChange={(e) => setCheckInType(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-200"
                  >
                    <option value="Single">Single</option>
                    <option value="Double">Double</option>
                    <option value="Accessible">Accessible</option>
                    <option value="Suite">Suite</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Nights</label>
                  <input 
                    type="number" 
                    value={checkInNights}
                    onChange={(e) => setCheckInNights(parseInt(e.target.value) || 1)}
                    min={1}
                    max={30}
                    required
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Floor Preference</label>
                  <select 
                    value={checkInFloor === null ? 'any' : checkInFloor} 
                    onChange={(e) => setCheckInFloor(e.target.value === 'any' ? null : parseInt(e.target.value))}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-200"
                  >
                    <option value="any">Any Floor</option>
                    <option value="1">1st Floor</option>
                    <option value="2">2nd Floor</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Elevator Proximity</label>
                  <select 
                    value={checkInProximity} 
                    onChange={(e) => setCheckInProximity(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-200"
                  >
                    <option value="None">No Preference</option>
                    <option value="Near Elevator">Near Elevator</option>
                    <option value="Near Stairs">Near Stairs</option>
                    <option value="Away From Elevator">Away From Elevator</option>
                  </select>
                </div>
              </div>

              <button 
                type="submit"
                className="mt-2 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-650 text-slate-950 font-bold heading-font flex items-center justify-center gap-1.5 hover:opacity-90 transition-all cursor-pointer shadow-lg shadow-cyan-500/10"
              >
                Perform Auto Room Check-In
              </button>
            </form>
          </section>

          {/* Check-Out */}
          <section className="bg-slate-900/40 border border-slate-800/80 shadow-xl shadow-slate-950/20 p-6 rounded-2xl">
            <h3 className="heading-font font-bold text-lg mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
              <LogOut size={18} className="text-cyan-500" />
              Guest Check-Out
            </h3>

            {checkoutMsg.text && (
              <div className={`text-xs p-3 rounded-xl border mb-4 ${
                checkoutMsg.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-rose-950/40 border-rose-800/50 text-rose-300'
              }`}>
                {checkoutMsg.text}
              </div>
            )}

            <form onSubmit={handleCheckOut} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Room Number</label>
                  <select 
                    value={checkoutRoom || ''} 
                    onChange={(e) => setCheckoutRoom(e.target.value ? parseInt(e.target.value) : null)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-200"
                  >
                    <option value="">Select Room</option>
                    {rooms.filter(r => r.status === 'Occupied').map(r => (
                      <option key={r.room_number} value={r.room_number}>Room {r.room_number}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Minibar Charges ($)</label>
                  <input 
                    type="number" 
                    value={checkoutMinibar}
                    onChange={(e) => setCheckoutMinibar(parseFloat(e.target.value) || 0)}
                    min={0}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1 col-span-2">
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Discount Type</label>
                  <select 
                    value={checkoutDiscountType} 
                    onChange={(e) => setCheckoutDiscountType(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-200"
                  >
                    <option value="none">No Discount</option>
                    <option value="fixed">Fixed Cash ($)</option>
                    <option value="percentage">Percentage (%)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Value</label>
                  <input 
                    type="number" 
                    value={checkoutDiscountVal}
                    onChange={(e) => setCheckoutDiscountVal(parseFloat(e.target.value) || 0)}
                    min={0}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase">Late Checkout Hours</label>
                <input 
                  type="number" 
                  value={checkoutLateHours}
                  onChange={(e) => setCheckoutLateHours(parseInt(e.target.value) || 0)}
                  min={0}
                  max={12}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                />
              </div>

              {checkoutPreview && (
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl flex flex-col gap-2 font-mono text-[10px] leading-relaxed text-slate-350">
                  <span className="text-xs font-bold text-cyan-400 mb-1">Billing Summary Preview</span>
                  <div className="flex justify-between">
                    <span>Base Room Charges:</span>
                    <span>${checkoutPreview.room_charges?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Room Service Charges:</span>
                    <span>${checkoutPreview.room_service_charges?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Minibar Charges:</span>
                    <span>${checkoutPreview.minibar_charges?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Late Checkout Fees:</span>
                    <span>${checkoutPreview.late_checkout_fees?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-900 pt-1">
                    <span>Subtotal:</span>
                    <span>${checkoutPreview.subtotal?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-rose-450">
                    <span>Discount:</span>
                    <span>-${checkoutPreview.discount?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tax (10% VAT):</span>
                    <span>${checkoutPreview.tax?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t border-cyan-900/50 pt-1 text-sm font-bold text-slate-100">
                    <span>Grand Total:</span>
                    <span className="text-cyan-400">${checkoutPreview.grand_total?.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <button 
                type="submit"
                disabled={!checkoutRoom}
                className="mt-2 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-650 text-slate-950 font-bold heading-font flex items-center justify-center gap-1.5 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-cyan-500/10"
              >
                Process Final Checkout & Billing
              </button>
            </form>
          </section>
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-950 bg-slate-950 py-4 text-center text-xs text-slate-600">
        <p>© 2026 HotelOS Frontdesk Operations. Receptionist Terminal. All Rights Reserved.</p>
      </footer>

    </div>
  );
}

export default App;
