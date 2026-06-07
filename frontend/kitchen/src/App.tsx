import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutGrid, Coffee, KeyRound, LogOut, CheckCircle2, AlertTriangle, ChevronRight
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

interface RoomServiceOrder {
  id: number;
  room_number: number;
  guest_id: number;
  items: Array<{ name: string; quantity: number; price: number }>;
  total_price: number;
  status: string; // Received, Preparing, Out For Delivery, Delivered
  created_at: string;
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
  const [token, setToken] = useState<string | null>(localStorage.getItem('kitchen_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // States
  const [rooms, setRooms] = useState<Room[]>([]);
  const [orders, setOrders] = useState<RoomServiceOrder[]>([]);
  const [chefName, setChefName] = useState('');
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [kitchenMsg, setKitchenMsg] = useState({ type: '', text: '' });

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
        if (data.staff_role !== 'kitchen_service' && data.staff_role !== 'super_admin') {
          setLoginError('Access denied: Kitchen dashboard requires Kitchen Service or Super Admin privileges.');
          return;
        }
        localStorage.setItem('kitchen_token', data.access_token);
        localStorage.setItem('kitchen_role', data.staff_role);
        localStorage.setItem('kitchen_username', data.username);
        setToken(data.access_token);
        setChefName(data.username);
      } else {
        const err = await res.json();
        setLoginError(formatErrorDetail(err.detail) || 'Authentication failed.');
      }
    } catch (e) {
      setLoginError('Unable to connect to Reception Service.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('kitchen_token');
    localStorage.removeItem('kitchen_role');
    localStorage.removeItem('kitchen_username');
    setToken(null);
    if (wsRef.current) wsRef.current.close();
  };

  const fetchData = async () => {
    if (!token) return;
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      const resRooms = await fetch('http://localhost:8001/api/reception/rooms');
      if (resRooms.ok) setRooms(await resRooms.json());

      const resOrders = await fetch('http://localhost:8003/api/room-service/orders', { headers });
      if (resOrders.status === 401 || resOrders.status === 403) {
        handleLogout();
        return;
      }
      if (resOrders.ok) setOrders(await resOrders.json());
    } catch (e) {
      console.error('Error fetching data:', e);
    }
  };

  // Next status transition
  const getNextStatus = (currStatus: string) => {
    if (currStatus === 'Received') return 'Preparing';
    if (currStatus === 'Preparing') return 'Out For Delivery';
    if (currStatus === 'Out For Delivery') return 'Delivered';
    return '';
  };

  const handleUpdateStatus = async (orderId: number, nextStatus: string) => {
    if (!nextStatus) return;
    setKitchenMsg({ type: '', text: '' });
    try {
      const res = await fetch(`http://localhost:8003/api/room-service/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        setKitchenMsg({ type: 'success', text: `Order #${orderId} status updated to: ${nextStatus}.` });
        fetchData();
      } else {
        const err = await res.json();
        setKitchenMsg({ type: 'error', text: formatErrorDetail(err.detail) || 'Failed to update order status.' });
      }
    } catch (e) {
      setKitchenMsg({ type: 'error', text: 'Error connecting to Room Service.' });
    }
  };

  // Websocket listeners
  useEffect(() => {
    if (!token) return;
    setChefName(localStorage.getItem('kitchen_username') || 'Chef');
    fetchData();

    setWsStatus('connecting');
    const ws = new WebSocket(`ws://localhost:8005/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onmessage = (event) => {
      try {
        const data: HotelEvent = JSON.parse(event.data);
        if (data.event_type.startsWith('room.status_changed') || data.event_type.startsWith('room_service.')) {
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
            <h1 className="heading-font font-bold text-2xl text-slate-100">Kitchen Service Portal</h1>
            <p className="text-slate-400 text-sm">Hotel Operations F&B and Kitchen Team Credentials Only</p>
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
                placeholder="chef1"
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
              Login to Kitchen
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Find active orders and rooms with active orders
  const activeOrders = orders.filter(o => o.status !== 'Delivered');
  const activeOrderRooms = activeOrders.map(o => o.room_number);

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 flex flex-col justify-between selection:bg-cyan-500/30">
      
      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-950/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-650 flex items-center justify-center">
              <span className="heading-font font-bold text-sm text-slate-950">H</span>
            </div>
            <span className="heading-font font-bold text-lg tracking-wider">HotelOS <span className="text-xs text-cyan-400 font-normal border border-cyan-800 px-2 py-0.5 rounded-full ml-2">Kitchen Dashboard</span></span>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <span className="text-slate-400 text-xs hidden sm:inline">User: <strong className="text-slate-200">{chefName}</strong></span>
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
        
        {/* Left Column: Room Grid with Order Highlighting */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-slate-900/40 border border-slate-800/80 shadow-xl shadow-slate-950/20 p-6 rounded-2xl">
            <h2 className="heading-font font-bold text-lg mb-2 flex items-center gap-2">
              <LayoutGrid size={18} className="text-cyan-500" />
              Kitchen Room Grid
            </h2>
            <p className="text-xs text-slate-400 mb-4 italic">Displaying all rooms; highlighting those with active room service food orders.</p>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {rooms.map((room) => {
                const hasOrder = activeOrderRooms.includes(room.room_number);
                const roomOrdersCount = activeOrders.filter(o => o.room_number === room.room_number).length;
                return (
                  <div 
                    key={room.room_number}
                    className={`border p-4 rounded-xl flex flex-col gap-2 transition-all relative overflow-hidden ${
                      hasOrder ? 'bg-emerald-950/10 border-emerald-500/35 hover:scale-[1.02]' : 'bg-slate-950/40 border-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="heading-font font-extrabold text-slate-100">Room {room.room_number}</span>
                      {hasOrder && (
                        <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-emerald-500/35 bg-emerald-500/10 text-emerald-400">
                          {roomOrdersCount} Order{roomOrdersCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col gap-0.5 text-[10px]">
                      <span className="text-slate-400 font-semibold">{room.room_type} (Flr {room.floor})</span>
                      <span className="text-slate-500">{room.status}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Room Service Preparation Queue */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <section className="bg-slate-900/40 border border-slate-800/80 shadow-xl shadow-slate-950/20 p-6 rounded-2xl">
            <h3 className="heading-font font-bold text-lg mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
              <Coffee size={18} className="text-cyan-500" />
              FIFO Food Preparation Queue
            </h3>

            {kitchenMsg.text && (
              <div className={`text-xs p-3 rounded-xl border mb-4 ${
                kitchenMsg.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-rose-950/40 border-rose-800/50 text-rose-300'
              }`}>
                {kitchenMsg.text}
              </div>
            )}

            <div className="flex flex-col gap-4 max-h-[500px] overflow-y-auto pr-1">
              {activeOrders.length === 0 ? (
                <div className="text-slate-500 text-center py-12 italic text-sm">No active room service orders. Kitchen stands by.</div>
              ) : (
                activeOrders.map((order) => {
                  const nextStatus = getNextStatus(order.status);
                  return (
                    <div key={order.id} className="bg-slate-950 border border-slate-850 p-4.5 rounded-xl flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="heading-font font-bold text-slate-200">Room {order.room_number}</span>
                          <span className="text-[10px] text-slate-500">Order #{order.id}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                            order.status === 'Received' ? 'bg-blue-500/10 border-blue-500/25 text-blue-400' :
                            order.status === 'Preparing' ? 'bg-orange-500/10 border-orange-500/25 text-orange-400' :
                            'bg-cyan-500/10 border-cyan-500/25 text-cyan-400'
                          }`}>
                            {order.status}
                          </span>
                        </div>

                        <span className="text-xs font-bold text-emerald-400">${order.total_price.toFixed(2)}</span>
                      </div>

                      {/* Items */}
                      <div className="bg-slate-900/40 border border-slate-900 p-3 rounded-lg flex flex-col gap-1.5 text-xs">
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-slate-350">
                            <span>
                              {item.quantity}x <strong className="text-slate-200">{item.name}</strong>
                            </span>
                            <span className="text-slate-500">${(item.price * item.quantity).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-900/60 pt-3.5 mt-0.5">
                        <span className="text-[10px] text-slate-500 font-mono">
                          Placed: {new Date(order.created_at).toLocaleTimeString()}
                        </span>

                        {nextStatus && (
                          <button
                            onClick={() => handleUpdateStatus(order.id, nextStatus)}
                            className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-500 to-indigo-650 hover:opacity-90 text-slate-950 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition-all shadow-md shadow-cyan-500/10 animate-pulse"
                          >
                            Advance to {nextStatus} <ChevronRight size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Recently Prepared Orders */}
            {orders.filter(o => o.status === 'Delivered').length > 0 && (
              <div className="mt-6 border-t border-slate-900 pt-4">
                <h4 className="heading-font font-semibold text-xs text-slate-400 uppercase tracking-wider mb-2.5">Recently Delivered Orders</h4>
                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                  {orders.filter(o => o.status === 'Delivered').slice(-5).map((order) => (
                    <div key={order.id} className="bg-slate-950/40 border border-slate-900/60 p-3 rounded-lg flex items-center justify-between text-xs text-slate-400">
                      <div>
                        Order <strong className="text-slate-300">#{order.id}</strong> to Room <span className="font-semibold text-slate-350">{order.room_number}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-2 font-mono">
                        <span>${order.total_price.toFixed(2)}</span>
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
        <p>© 2026 HotelOS F&B Kitchen. Kitchen Portal. All Rights Reserved.</p>
      </footer>

    </div>
  );
}

export default App;
