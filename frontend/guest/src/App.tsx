import React, { useState, useEffect, useRef } from 'react';
import { 
  Coffee, Wrench, Receipt, Bell, ShieldCheck, ShoppingCart, 
  Plus, Minus, Send, CheckCircle2, Clock, Truck, ShieldAlert, Sparkles, LogOut
} from 'lucide-react';

// Interfaces
interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface RoomServiceOrder {
  id: number;
  room_number: number;
  guest_id: number;
  items: OrderItem[];
  total_price: number;
  status: string;
  created_at: string;
}

interface MaintenanceIssue {
  id: number;
  room_number: number;
  description: string;
  priority: number;
  status: string;
  assigned_technician: string | null;
  created_at: string;
}

interface BillPreview {
  room_charges: number;
  room_service_charges: number;
  minibar_charges: number;
  late_checkout_fees: number;
  subtotal: number;
  discount: number;
  tax: number;
  grand_total: number;
  itemized_bill: string;
  nights: number;
}

const MENU_ITEMS = [
  { id: 1, name: 'Espresso Coffee', category: 'Beverage', price: 4.50, desc: 'Freshly brewed aromatic Italian roast' },
  { id: 2, name: 'Club Sandwich', category: 'Food', price: 12.00, desc: 'Double decker chicken, bacon, lettuce & tomato' },
  { id: 3, name: 'Butter Croissant', category: 'Food', price: 3.50, desc: 'Flaky French pastry baked fresh daily' },
  { id: 4, name: 'Sparkling Mineral Water', category: 'Beverage', price: 3.00, desc: 'Premium chilled spring water' },
  { id: 5, name: 'Caesar Salad', category: 'Food', price: 10.50, desc: 'Crisp romaine, parmesan, croutons & dressing' },
  { id: 6, name: 'Classic Coca-Cola', category: 'Beverage', price: 3.50, desc: 'Served chilled with ice and lemon slice' },
];

const formatErrorDetail = (detail: any): string => {
  if (!detail) return 'An unknown error occurred.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(d => {
      const field = Array.isArray(d.loc) ? d.loc.slice(1).join('.') : '';
      return `${field ? field + ': ' : ''}${d.msg}`;
    }).join(', ');
  }
  if (typeof detail === 'object') {
    return JSON.stringify(detail);
  }
  return String(detail);
};

const parseItems = (items: any): OrderItem[] => {
  if (!items) return [];
  if (typeof items === 'string') {
    try {
      return JSON.parse(items);
    } catch (e) {
      console.error("Failed to parse items json:", e);
      return [];
    }
  }
  if (Array.isArray(items)) return items;
  return [];
};

function App() {
  const [guestToken, setGuestToken] = useState<string | null>(localStorage.getItem('guest_token'));
  const [guestName, setGuestName] = useState(localStorage.getItem('guest_name') || '');
  const [roomNumber, setRoomNumber] = useState<number | null>(Number(localStorage.getItem('guest_room')) || null);
  const [guestId, setGuestId] = useState<number | null>(Number(localStorage.getItem('guest_id')) || null);
  const [reservationCode, setReservationCode] = useState(localStorage.getItem('reservation_code') || '');

  // Login inputs
  const [loginMethod, setLoginMethod] = useState<'room' | 'code'>('room');
  const [inputRoom, setInputRoom] = useState('');
  const [inputName, setInputName] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [loginError, setLoginError] = useState('');

  // Dashboard views
  const [activeView, setActiveView] = useState<'menu' | 'maintenance' | 'charges'>('menu');

  // Live data states
  const [orders, setOrders] = useState<RoomServiceOrder[]>([]);
  const [issues, setIssues] = useState<MaintenanceIssue[]>([]);
  const [bill, setBill] = useState<BillPreview | null>(null);
  const [notifications, setNotifications] = useState<{ id: string; text: string }[]>([]);

  // Cart state
  const [cart, setCart] = useState<{[key: number]: number}>({}); // item_id -> quantity
  const [orderSuccessMsg, setOrderSuccessMsg] = useState('');

  // Maintenance reporting state
  const [maintDesc, setMaintDesc] = useState('');
  const [maintUrgency, setMaintUrgency] = useState('Normal');
  const [maintSuccessMsg, setMaintSuccessMsg] = useState('');
  const [maintBeforePhoto, setMaintBeforePhoto] = useState<string>('');

  // Refs
  const wsRef = useRef<WebSocket | null>(null);

  // Authentication Handlers
  const handleRoomLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!inputRoom || !inputName) return;
    try {
      const res = await fetch(`http://localhost:8001/api/reception/guest/login?room_number=${inputRoom}&guest_name=${encodeURIComponent(inputName)}`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        saveSession(data.access_token, inputName, Number(inputRoom), data.guest_id, data.reservation_code);
      } else {
        const err = await res.json();
        setLoginError(formatErrorDetail(err.detail) || 'Login failed. Verify room number and spelling.');
      }
    } catch (e) {
      setLoginError('Error connecting to Reception Service.');
    }
  };

  const handleCodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!inputCode) return;
    try {
      const res = await fetch(`http://localhost:8001/api/reception/guest/login/code?code=${encodeURIComponent(inputCode)}`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        saveSession(data.access_token, data.guest_name, data.room_number, data.guest_id || 1, inputCode);
      } else {
        const err = await res.json();
        setLoginError(formatErrorDetail(err.detail) || 'Invalid reservation code.');
      }
    } catch (e) {
      setLoginError('Error connecting to Reception Service.');
    }
  };

  const saveSession = (tok: string, name: string, room: number, gId: number, resCode: string) => {
    localStorage.setItem('guest_token', tok);
    localStorage.setItem('guest_name', name);
    localStorage.setItem('guest_room', String(room));
    localStorage.setItem('guest_id', String(gId));
    localStorage.setItem('reservation_code', resCode);
    
    setGuestToken(tok);
    setGuestName(name);
    setRoomNumber(room);
    setGuestId(gId);
    setReservationCode(resCode);
  };

  const handleLogout = () => {
    localStorage.clear();
    setGuestToken(null);
    setGuestName('');
    setRoomNumber(null);
    setGuestId(null);
    setReservationCode('');
    if (wsRef.current) wsRef.current.close();
  };

  // Fetch stay information
  const fetchStayData = async () => {
    if (!guestToken || !roomNumber) return;
    const headers = { 'Authorization': `Bearer ${guestToken}` };
    try {
      // 1. Fetch Room Service Orders
      const resOrders = await fetch(`http://localhost:8003/api/room-service/guest/orders?room_number=${roomNumber}`, { headers });
      if (resOrders.status === 401 || resOrders.status === 403) {
        handleLogout();
        return;
      }
      if (resOrders.ok) setOrders(await resOrders.json());

      // 2. Fetch Maintenance issues
      const resIssues = await fetch(`http://localhost:8004/api/maintenance/room/${roomNumber}/issues`, { headers });
      if (resIssues.status === 401 || resIssues.status === 403) {
        handleLogout();
        return;
      }
      if (resIssues.ok) setIssues(await resIssues.json());

      // 3. Fetch Billing charges preview
      const resBill = await fetch(`http://localhost:8001/api/reception/checkout/preview?room_number=${roomNumber}`);
      if (resBill.status === 404 || resBill.status === 401 || resBill.status === 403) {
        handleLogout();
        return;
      }
      if (resBill.ok) setBill(await resBill.json());

    } catch (e) {
      console.error('Error fetching guest stay data:', e);
    }
  };

  // Initialize data and WebSockets
  useEffect(() => {
    if (!guestToken || !roomNumber) return;
    fetchStayData();

    // Establish WebSocket Connection with token
    const ws = new WebSocket(`ws://localhost:8005/ws?token=${guestToken}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const hotelEvent = JSON.parse(event.data);
        const { event_type, payload } = hotelEvent;

        // Auto-logout if checked out
        if (event_type === 'guest.checked_out' && Number(payload.room_number) === Number(roomNumber)) {
          handleLogout();
          return;
        }

        // Visual alerts
        let alertText = '';
        if (event_type === 'room_service.updated' && payload.room_number === roomNumber) {
          alertText = `Room Service Order #${payload.id} is now ${payload.status}!`;
        } else if (event_type === 'maintenance.assigned' && payload.room_number === roomNumber) {
          alertText = `Technician ${payload.assigned_technician} has been dispatched to resolve your reported issue.`;
        } else if (event_type === 'maintenance.resolved' && payload.room_number === roomNumber) {
          alertText = `Your reported maintenance issue has been resolved.`;
        }

        if (alertText) {
          const id = String(Math.random());
          setNotifications(prev => [...prev, { id, text: alertText }]);
          setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
          }, 5000);
        }

        // Live refresh guest states
        fetchStayData();
      } catch (err) {
        console.error('Failed to parse WebSocket gateway message:', err);
      }
    };

    return () => {
      ws.close();
    };
  }, [guestToken, roomNumber]);

  // Cart operations
  const addToCart = (id: number) => {
    setCart(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  const removeFromCart = (id: number) => {
    setCart(prev => {
      const q = prev[id] || 0;
      if (q <= 1) {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      }
      return { ...prev, [id]: q - 1 };
    });
  };

  const getCartItemsList = () => {
    return Object.entries(cart).map(([itemIdStr, qty]) => {
      const menu = MENU_ITEMS.find(m => m.id === Number(itemIdStr))!;
      return {
        name: menu.name,
        quantity: qty,
        price: menu.price
      };
    });
  };

  const getCartTotal = () => {
    return getCartItemsList().reduce((sum, item) => sum + (item.price * item.quantity), 0.0);
  };

  const handlePlaceOrder = async () => {
    const items = getCartItemsList();
    if (items.length === 0 || !roomNumber || !guestId) return;

    try {
      const res = await fetch('http://localhost:8003/api/room-service/order', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`
        },
        body: JSON.stringify({
          room_number: roomNumber,
          guest_id: guestId,
          items: items
        })
      });
      if (res.ok) {
        setCart({});
        setOrderSuccessMsg('Your room service order has been placed and sent to the kitchen!');
        fetchStayData();
        setTimeout(() => setOrderSuccessMsg(''), 5000);
      } else {
        const err = await res.json();
        const errMsg = formatErrorDetail(err.detail) || 'Failed to place order.';
        alert(errMsg);
        if (errMsg.includes('not checked in') || res.status === 401 || res.status === 403) {
          handleLogout();
        }
      }
    } catch (e) {
      alert('Error submitting order.');
    }
  };

  // Submit Maintenance Issue
  const handleReportIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!maintDesc || !roomNumber) return;

    try {
      const res = await fetch('http://localhost:8004/api/maintenance/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_number: roomNumber,
          description: maintDesc,
          urgency_level: maintUrgency,
          guest_id: guestId,
          before_photo: maintBeforePhoto || null
        })
      });
      if (res.ok) {
        setMaintDesc('');
        setMaintUrgency('Normal');
        setMaintBeforePhoto('');
        setMaintSuccessMsg('Maintenance ticket queued successfully. Technicians are being scheduled.');
        fetchStayData();
        setTimeout(() => setMaintSuccessMsg(''), 5000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Show login portal if guest not authenticated
  if (!guestToken) {
    return (
      <div className="min-h-screen bg-[#090d16] flex items-center justify-center relative p-6">
        {/* Background glowing decorations */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 rounded-3xl p-8 backdrop-blur-xl shadow-2xl relative z-10 flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-650 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <span className="heading-font font-bold text-xl text-slate-950">H</span>
            </div>
            <h1 className="heading-font font-bold text-2xl text-slate-100">HotelOS Guest Portal</h1>
            <p className="text-slate-400 text-sm">Access your room dashboard and stay amenities</p>
          </div>

          {/* Login Tabs */}
          <div className="flex bg-slate-950/80 p-1.5 rounded-xl border border-slate-800/80">
            <button 
              onClick={() => { setLoginMethod('room'); setLoginError(''); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg heading-font transition-all ${
                loginMethod === 'room' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Room & Name
            </button>
            <button 
              onClick={() => { setLoginMethod('code'); setLoginError(''); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg heading-font transition-all ${
                loginMethod === 'code' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Reservation Code
            </button>
          </div>

          {loginError && (
            <div className="bg-rose-950/40 border border-rose-800/50 text-rose-300 text-sm p-4 rounded-xl flex items-center gap-2">
              <ShieldAlert size={16} className="shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          {loginMethod === 'room' ? (
            <form onSubmit={handleRoomLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Room Number</label>
                <input 
                  type="number" 
                  value={inputRoom}
                  onChange={(e) => setInputRoom(e.target.value)}
                  placeholder="e.g. 203"
                  required
                  className="w-full bg-slate-950/85 border border-slate-850 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 text-slate-200"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Guest Last/First Name</label>
                <input 
                  type="text" 
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  placeholder="e.g. John Doe"
                  required
                  className="w-full bg-slate-950/85 border border-slate-850 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 text-slate-200"
                />
              </div>

              <button 
                type="submit"
                className="mt-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-650 text-slate-950 font-bold heading-font flex items-center justify-center gap-2 hover:opacity-90 transition-all cursor-pointer"
              >
                Access Guest Services
              </button>
            </form>
          ) : (
            <form onSubmit={handleCodeLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Reservation Code</label>
                <input 
                  type="text" 
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                  placeholder="RES-XXXXXX"
                  required
                  className="w-full bg-slate-950/85 border border-slate-850 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 text-slate-200 font-mono"
                />
              </div>

              <button 
                type="submit"
                className="mt-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-650 text-slate-950 font-bold heading-font flex items-center justify-center gap-2 hover:opacity-90 transition-all cursor-pointer"
              >
                Access Guest Services
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col justify-between selection:bg-cyan-500/20">
      
      {/* Background decorations */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Live Toast Notifications */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full">
        {notifications.map(n => (
          <div key={n.id} className="bg-slate-900/95 border-l-4 border-cyan-500 p-4 rounded-xl shadow-2xl flex items-start gap-3 backdrop-blur border border-slate-800">
            <Bell size={18} className="text-cyan-400 shrink-0 mt-0.5 animate-bounce" />
            <div className="flex-grow text-xs text-slate-200 font-medium leading-relaxed">{n.text}</div>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-950/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center">
              <span className="heading-font font-bold text-slate-950">H</span>
            </div>
            <div>
              <span className="heading-font font-bold text-lg tracking-wider">HotelOS</span>
              <span className="text-slate-500 text-xs ml-2 font-mono">Room {roomNumber}</span>
              {reservationCode && <span className="text-slate-500 text-xs ml-2 font-mono">({reservationCode})</span>}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-xs text-slate-400 font-semibold">
              Welcome, <strong className="text-slate-200">{guestName}</strong>
            </span>
            <button 
              onClick={handleLogout}
              className="p-1.5 bg-slate-900 border border-slate-800 hover:border-rose-900 hover:bg-rose-900/20 text-slate-400 hover:text-rose-400 rounded-lg cursor-pointer transition-all"
              title="Logout from room portal"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-6 py-8 flex-grow w-full grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        
        {/* Left Column: Menu Ordering / Issues Reporting */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Main Navigation */}
          <div className="flex bg-slate-950/60 border border-slate-900 p-1.5 rounded-2xl max-w-sm w-full">
            <button 
              onClick={() => setActiveView('menu')}
              className={`flex-grow py-2 text-xs font-semibold heading-font rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                activeView === 'menu' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Coffee size={14} />
              Digital Minibar Menu
            </button>
            <button 
              onClick={() => setActiveView('maintenance')}
              className={`flex-grow py-2 text-xs font-semibold heading-font rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                activeView === 'maintenance' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wrench size={14} />
              Maintenance Requests
            </button>
            <button 
              onClick={() => setActiveView('charges')}
              className={`flex-grow py-2 text-xs font-semibold heading-font rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                activeView === 'charges' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Receipt size={14} />
              Bill Receipt Details
            </button>
          </div>

          {/* VIEW: DIGITAL MENU & CART */}
          {activeView === 'menu' && (
            <div className="flex flex-col gap-6">
              {orderSuccessMsg && (
                <div className="bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-sm p-4 rounded-xl flex items-center gap-2">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span>{orderSuccessMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {MENU_ITEMS.map(item => {
                  const qty = cart[item.id] || 0;
                  return (
                    <div key={item.id} className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl flex justify-between items-center gap-4 relative overflow-hidden group">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] bg-slate-950 border border-slate-850 px-2 py-0.5 rounded-full w-fit text-slate-500 font-bold uppercase">{item.category}</span>
                        <h4 className="heading-font font-bold text-slate-200">{item.name}</h4>
                        <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                        <span className="text-sm font-bold text-cyan-400 mt-1">${item.price.toFixed(2)}</span>
                      </div>
                      
                      {/* Quantity Controls */}
                      <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-850">
                        {qty > 0 ? (
                          <>
                            <button 
                              onClick={() => removeFromCart(item.id)}
                              className="w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 flex items-center justify-center cursor-pointer"
                            >
                              <Minus size={12} />
                            </button>
                            <span className="w-6 text-center text-xs font-bold text-slate-200">{qty}</span>
                            <button 
                              onClick={() => addToCart(item.id)}
                              className="w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 flex items-center justify-center cursor-pointer"
                            >
                              <Plus size={12} />
                            </button>
                          </>
                        ) : (
                          <button 
                            onClick={() => addToCart(item.id)}
                            className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1 cursor-pointer"
                          >
                            <ShoppingCart size={12} />
                            Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Shopping Cart Drawer */}
              {getCartTotal() > 0 && (
                <div className="bg-slate-900/60 border border-cyan-900/50 p-6 rounded-2xl flex flex-col gap-4 shadow-xl">
                  <h3 className="heading-font font-bold text-base text-slate-200 flex items-center gap-2">
                    <ShoppingCart size={16} className="text-cyan-400" />
                    Live Price Cart Calculator
                  </h3>

                  <div className="flex flex-col gap-2 border-b border-slate-800 pb-3">
                    {getCartItemsList().map((item, idx) => (
                      <div key={idx} className="flex justify-between text-xs text-slate-400">
                        <span>{item.quantity}x {item.name}</span>
                        <span>${(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Estimated Subtotal</span>
                      <span className="text-xl font-bold text-cyan-400heading-font">${getCartTotal().toFixed(2)}</span>
                    </div>

                    <button 
                      onClick={handlePlaceOrder}
                      className="px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-slate-950 font-bold heading-font flex items-center gap-1.5 shadow-lg shadow-cyan-500/20 hover:opacity-90 transition-all cursor-pointer"
                    >
                      <Send size={14} />
                      Submit Order to Kitchen
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW: MAINTENANCE REPORTER */}
          {activeView === 'maintenance' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Form */}
              <div className="bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl flex flex-col gap-4 self-start">
                <h3 className="heading-font font-bold text-base text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Wrench size={16} className="text-cyan-400" />
                  Submit Maintenance Ticket
                </h3>

                {maintSuccessMsg && (
                  <div className="bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs p-4 rounded-xl">
                    {maintSuccessMsg}
                  </div>
                )}

                <form onSubmit={handleReportIssue} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold uppercase">Urgency Level</label>
                    <select 
                      value={maintUrgency} 
                      onChange={(e) => setMaintUrgency(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                    >
                      <option>Critical</option>
                      <option>High</option>
                      <option>Normal</option>
                      <option>Low</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold uppercase">Describe the Issue</label>
                    <textarea 
                      value={maintDesc} 
                      onChange={(e) => setMaintDesc(e.target.value)}
                      placeholder="e.g. Toilet is leaking, heating unit making noise, keycard slot not flashing green..."
                      required
                      rows={4}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-slate-400 font-semibold uppercase">Attach Photo (Optional)</label>
                    <div className="flex items-center gap-3">
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setMaintBeforePhoto(reader.result as string);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none text-slate-400 w-full"
                      />
                      {maintBeforePhoto && (
                        <img src={maintBeforePhoto} className="w-12 h-12 object-cover rounded-lg border border-slate-800" alt="Before preview" />
                      )}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setMaintBeforePhoto("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%237f1d1d'/><text x='50' y='50' fill='%23fca5a5' font-size='10' font-family='sans-serif' text-anchor='middle' font-weight='bold'>LEAKING TOILET</text></svg>")}
                        className="px-2 py-1 bg-slate-950 border border-slate-850 hover:border-slate-800 text-[10px] text-slate-400 rounded cursor-pointer transition-all"
                      >
                        Mock Leaking Toilet
                      </button>
                      <button
                        type="button"
                        onClick={() => setMaintBeforePhoto("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%2378350f'/><text x='50' y='50' fill='%23fde047' font-size='10' font-family='sans-serif' text-anchor='middle' font-weight='bold'>BROKEN LIGHT</text></svg>")}
                        className="px-2 py-1 bg-slate-950 border border-slate-850 hover:border-slate-800 text-[10px] text-slate-400 rounded cursor-pointer transition-all"
                      >
                        Mock Broken Light
                      </button>
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold heading-font flex items-center justify-center gap-1.5 hover:opacity-90 transition-all cursor-pointer"
                  >
                    Submit Request
                  </button>
                </form>
              </div>

              {/* Active tickets */}
              <div className="flex flex-col gap-4">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-2 block">
                  Reported Maintenance Status
                </span>

                <div className="flex flex-col gap-3">
                  {issues.length === 0 ? (
                    <div className="text-slate-600 text-xs italic py-8 text-center bg-slate-950/20 border border-slate-850 rounded-xl">
                      No maintenance issues reported for Room {roomNumber}.
                    </div>
                  ) : (
                    issues.map(issue => (
                      <div key={issue.id} className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl flex flex-col gap-2">
                        <div className="flex items-center justify-between border-b border-slate-850 pb-1.5">
                          <span className="text-xs text-slate-500">{new Date(issue.created_at).toLocaleDateString()}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                            issue.status === 'Pending' ? 'bg-amber-950 text-amber-400' :
                            issue.status === 'Assigned' ? 'bg-cyan-950 text-cyan-400 animate-pulse' : 'bg-emerald-950 text-emerald-400'
                          }`}>
                            {issue.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 italic">"{issue.description}"</p>
                        {issue.assigned_technician && (
                          <div className="text-[10px] text-slate-500">
                            Assigned Technician: <strong className="text-slate-400">{issue.assigned_technician}</strong>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* VIEW: RECEIPT DETAILS */}
          {activeView === 'charges' && (
            <div className="bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl flex flex-col gap-6">
              <h3 className="heading-font font-bold text-base text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-3">
                <Receipt size={16} className="text-cyan-400" />
                Current Charges Invoice Details
              </h3>

              {bill ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 font-mono">
                  {/* Itemized list */}
                  <div className="flex flex-col gap-4 text-xs text-slate-400">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider font-sans">Summary Breakdown</span>
                    <div className="flex justify-between border-b border-slate-850 pb-1.5">
                      <span>Room Nights ({bill.nights} nights):</span>
                      <span className="text-slate-200">${bill.room_charges.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-850 pb-1.5">
                      <span>Room Service Orders:</span>
                      <span className="text-slate-200">${bill.room_service_charges.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-850 pb-1.5">
                      <span>Late Fees:</span>
                      <span className="text-slate-200">${bill.late_checkout_fees.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-850 pb-1.5">
                      <span>Minibar Charges:</span>
                      <span className="text-slate-200">${bill.minibar_charges.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-850 pb-1.5">
                      <span>Tax (10% VAT):</span>
                      <span className="text-slate-200">${bill.tax.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-base text-cyan-400 font-bold pt-2">
                      <span>Grand Total:</span>
                      <span>${bill.grand_total.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Receipt Text */}
                  <div className="bg-slate-950 p-4 border border-slate-850 rounded-xl max-h-[300px] overflow-y-auto">
                    <pre className="text-[10px] text-slate-400 leading-relaxed whitespace-pre-wrap">{bill.itemized_bill}</pre>
                  </div>
                </div>
              ) : (
                <div className="text-slate-500 text-xs italic py-12 text-center">
                  Calculating charges...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Order Trackers & Stay Summary */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Active Orders Tracker */}
          <section className="bg-slate-950 border border-slate-900 rounded-3xl p-6 flex flex-col gap-4">
            <h3 className="heading-font font-bold text-sm text-slate-200 border-b border-slate-900 pb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-cyan-500" />
              Kitchen Order Tracking
            </h3>

            <div className="flex flex-col gap-4 max-h-[420px] overflow-y-auto">
              {orders.length === 0 ? (
                <div className="text-slate-600 text-xs text-center py-12 italic">
                  No orders placed yet.
                </div>
              ) : (
                orders.map(order => (
                  <div key={order.id} className="bg-slate-900/40 border border-slate-850 p-4 rounded-2xl flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 font-mono">Order #{order.id}</span>
                      <span className="text-xs font-bold text-cyan-400">${order.total_price.toFixed(2)}</span>
                    </div>

                    <div className="flex flex-col gap-1 text-[11px] text-slate-400">
                      {parseItems(order.items).map((it, idx) => (
                        <div key={idx} className="flex justify-between">
                          <span>{it.quantity}x {it.name}</span>
                        </div>
                      ))}
                    </div>

                    {/* Progress Bar */}
                    <div className="flex items-center justify-between gap-2 border-t border-slate-850 pt-2.5 text-[9px] font-bold tracking-wider">
                      <div className="flex items-center gap-1">
                        {order.status === 'Received' ? <Clock size={10} className="text-blue-400" /> : <CheckCircle2 size={10} className="text-emerald-400" />}
                        <span className={order.status === 'Received' ? 'text-blue-400 font-bold' : 'text-slate-500 font-normal'}>Received</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {order.status === 'Preparing' ? <Clock size={10} className="text-amber-400 animate-pulse" /> : 
                         (order.status === 'Out For Delivery' || order.status === 'Delivered') ? <CheckCircle2 size={10} className="text-emerald-400" /> :
                         <Clock size={10} className="text-slate-600" />}
                        <span className={order.status === 'Preparing' ? 'text-amber-400 font-bold' : 'text-slate-500 font-normal'}>Preparing</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {order.status === 'Out For Delivery' ? <Truck size={10} className="text-violet-400 animate-bounce" /> :
                         order.status === 'Delivered' ? <CheckCircle2 size={10} className="text-emerald-400" /> :
                         <Clock size={10} className="text-slate-600" />}
                        <span className={order.status === 'Out For Delivery' ? 'text-violet-400 font-bold' : 'text-slate-500 font-normal'}>In Transit</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {order.status === 'Delivered' ? <CheckCircle2 size={10} className="text-emerald-400" /> : <Clock size={10} className="text-slate-600" />}
                        <span className={order.status === 'Delivered' ? 'text-emerald-400 font-bold' : 'text-slate-500 font-normal'}>Delivered</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Code security details */}
          <section className="bg-slate-950/45 border border-slate-900 p-6 rounded-2xl text-[10px] text-slate-500 flex flex-col gap-2">
            <span className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <ShieldCheck size={12} className="text-emerald-500" />
              Secure Guest Isolation
            </span>
            <p className="leading-relaxed">
              Your session is bound exclusively to Room {roomNumber} via cryptographic tokens. Direct calls to neighboring rooms are blocked at the service API layer.
            </p>
          </section>
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-950 bg-slate-950 py-4 text-center text-xs text-slate-600">
        <p>© 2026 HotelOS System Operations. Guest Portal Service. All Rights Reserved.</p>
      </footer>

    </div>
  );
}

export default App;
