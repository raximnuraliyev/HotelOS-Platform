import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutGrid, Users, ClipboardCheck, Coffee, Wrench, ShieldAlert,
  Terminal, ScrollText, Pause, Trash2, KeyRound, LogOut, CheckCircle2, AlertTriangle, UserCheck
} from 'lucide-react';

// TypeScript interfaces
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

interface HousekeepingTask {
  id: number;
  room_number: number;
  status: string;
  assigned_housekeeper: string | null;
  created_at: string;
  completed_at: string | null;
}

interface MaintenanceIssue {
  id: number;
  room_number: number;
  description: string;
  priority: number;
  status: string;
  assigned_technician: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface RoomServiceOrder {
  id: number;
  room_number: number;
  guest_id: number;
  items: Array<{ name: string; quantity: number; price: number }>;
  total_price: number;
  status: string;
  created_at: string;
}

interface AuditLog {
  id: number;
  timestamp: string;
  service: string;
  event_type: string;
  message: string;
  payload: string;
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
  if (typeof detail === 'object') {
    return JSON.stringify(detail);
  }
  return String(detail);
};

const parseItems = (items: any): Array<{ name: string; quantity: number; price: number }> => {
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
  const [token, setToken] = useState<string | null>(localStorage.getItem('staff_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // Dashboard UI tabs
  const [activeTab, setActiveTab] = useState<'rooms' | 'reception' | 'housekeeping' | 'maintenance' | 'roomservice' | 'audit' | 'staff'>('rooms');
  
  // Live states
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [housekeepingTasks, setHousekeepingTasks] = useState<HousekeepingTask[]>([]);
  const [maintenanceIssues, setMaintenanceIssues] = useState<MaintenanceIssue[]>([]);
  const [roomServiceOrders, setRoomServiceOrders] = useState<RoomServiceOrder[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  
  // Staff management states
  const [staffMembers, setStaffMembers] = useState<any[]>([]);
  const [newStaffUsername, setNewStaffUsername] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('receptionist');
  const [staffMsg, setStaffMsg] = useState({ type: '', text: '' });
  
  // Event stream state
  const [events, setEvents] = useState<HotelEvent[]>([]);
  const [pausedEvents, setPausedEvents] = useState(false);
  const [filterService, setFilterService] = useState<string>('all');
  const [filterEventType, setFilterEventType] = useState<string>('all');
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  
  // Forms states
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

  const [assignHousekeeperName, setAssignHousekeeperName] = useState<{[key: number]: string}>({});
  const [newMaintenanceDesc, setNewMaintenanceDesc] = useState('');
  const [newMaintenanceUrgency, setNewMaintenanceUrgency] = useState('Normal');
  const [newMaintenanceRoom, setNewMaintenanceRoom] = useState<number>(101);

  // References
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch staff list
  const fetchStaff = async () => {
    const curToken = localStorage.getItem('staff_token');
    if (!curToken) return;
    const headers = { 'Authorization': `Bearer ${curToken}` };
    try {
      const res = await fetch('http://localhost:8001/api/reception/staff', { headers });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      if (res.ok) setStaffMembers(await res.json());
    } catch (e) {
      console.error('Error fetching staff:', e);
    }
  };

  // Create staff handler
  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffMsg({ type: '', text: '' });
    if (!newStaffUsername || !newStaffPassword) return;
    try {
      const res = await fetch('http://localhost:8001/api/reception/staff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          username: newStaffUsername,
          password: newStaffPassword,
          role: newStaffRole
        })
      });
      if (res.ok) {
        setStaffMsg({ type: 'success', text: `Staff member '${newStaffUsername}' created successfully.` });
        setNewStaffUsername('');
        setNewStaffPassword('');
        fetchStaff();
      } else {
        const err = await res.json();
        setStaffMsg({ type: 'error', text: formatErrorDetail(err.detail) || 'Failed to create staff member.' });
      }
    } catch (e) {
      setStaffMsg({ type: 'error', text: 'Error connecting to reception service.' });
    }
  };

  // Delete staff handler
  const handleDeleteStaff = async (id: number, uName: string) => {
    if (!window.confirm(`Are you sure you want to delete staff member '${uName}'?`)) return;
    setStaffMsg({ type: '', text: '' });
    try {
      const res = await fetch(`http://localhost:8001/api/reception/staff/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setStaffMsg({ type: 'success', text: `Staff member '${uName}' deleted.` });
        fetchStaff();
      } else {
        const err = await res.json();
        setStaffMsg({ type: 'error', text: formatErrorDetail(err.detail) || 'Failed to delete staff member.' });
      }
    } catch (e) {
      setStaffMsg({ type: 'error', text: 'Error connecting to reception service.' });
    }
  };

  // Log in handler
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
        if (data.staff_role !== 'super_admin') {
          setLoginError('Access denied: Operations portal requires Super Admin privileges.');
          return;
        }
        localStorage.setItem('staff_token', data.access_token);
        localStorage.setItem('staff_role', data.staff_role);
        setToken(data.access_token);
      } else {
        const err = await res.json();
        setLoginError(formatErrorDetail(err.detail) || 'Authentication failed.');
      }
    } catch (e) {
      setLoginError('Unable to connect to Reception Service.');
    }
  };

  // Log out handler
  const handleLogout = () => {
    localStorage.removeItem('staff_token');
    localStorage.removeItem('staff_role');
    setToken(null);
    if (wsRef.current) wsRef.current.close();
  };

  // Fetch initial REST data
  const fetchData = async () => {
    if (!token) return;
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      // Fetch Rooms
      const resRooms = await fetch('http://localhost:8001/api/reception/rooms');
      if (resRooms.ok) setRooms(await resRooms.json());

      // Fetch Guests
      const resGuests = await fetch('http://localhost:8001/api/reception/guests');
      if (resGuests.ok) setGuests(await resGuests.json());

      // Fetch Housekeeping
      const resHK = await fetch('http://localhost:8002/api/housekeeping/tasks', { headers });
      if (resHK.status === 401 || resHK.status === 403) {
        handleLogout();
        return;
      }
      if (resHK.ok) setHousekeepingTasks(await resHK.json());

      // Fetch Maintenance
      const resMaint = await fetch('http://localhost:8004/api/maintenance/issues', { headers });
      if (resMaint.status === 401 || resMaint.status === 403) {
        handleLogout();
        return;
      }
      if (resMaint.ok) setMaintenanceIssues(await resMaint.json());

      // Fetch Room Service
      const resRS = await fetch('http://localhost:8003/api/room-service/orders', { headers });
      if (resRS.status === 401 || resRS.status === 403) {
        handleLogout();
        return;
      }
      if (resRS.ok) setRoomServiceOrders(await resRS.json());

      // Fetch Audit Logs
      const resAudit = await fetch('http://localhost:8001/api/reception/audit-logs', { headers });
      if (resAudit.status === 401 || resAudit.status === 403) {
        handleLogout();
        return;
      }
      if (resAudit.ok) setAuditLogs(await resAudit.json());

      // Fetch Staff
      fetchStaff();
      
    } catch (e) {
      console.error('Error fetching dashboard REST data:', e);
    }
  };

  // Initialize data and WebSocket stream
  useEffect(() => {
    if (!token) return;
    fetchData();

    // Setup WebSockets Connection
    setWsStatus('connecting');
    const ws = new WebSocket(`ws://localhost:8005/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('connected');
      console.log('WebSocket Gateway connected');
    };

    ws.onmessage = (event) => {
      try {
        const hotelEvent: HotelEvent = JSON.parse(event.data);
        
        // Append to terminal logs (unless paused)
        setPausedEvents(prev => {
          if (!prev) {
            setEvents(logs => [...logs, hotelEvent]);
          }
          return prev;
        });

        // Trigger reactive state updates based on event payload
        handleIncomingEvent(hotelEvent);

      } catch (err) {
        console.error('Failed to parse websocket event:', err);
      }
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      console.log('WebSocket Gateway disconnected');
    };

    ws.onerror = () => {
      setWsStatus('disconnected');
    };

    return () => {
      ws.close();
    };
  }, [token]);

  // Handle local state transitions based on live WebSocket events
  const handleIncomingEvent = (event: HotelEvent) => {
    const { event_type, payload } = event;
    console.log(`[Event Received] ${event_type}`, payload);

    // Refresh data lists to maintain perfect synchronization
    fetchData();
  };

  // Scroll to bottom of terminal
  useEffect(() => {
    if (terminalEndRef.current && !pausedEvents) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, pausedEvents]);

  // Executing Guest Check-In
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
          proximity_preference: checkInProximity,
          nights: Number(checkInNights)
        })
      });
      const data = await res.json();
      if (res.ok) {
        setCheckInMsg({ 
          type: 'success', 
          text: `Checked in! Assigned Room ${data.room_number}. Res Code: ${data.guest.reservation_code}` 
        });
        setCheckInName('');
        setCheckInFloor(null);
        setCheckInProximity('None');
        setCheckInNights(1);
      } else {
        setCheckInMsg({ type: 'error', text: formatErrorDetail(data.detail) || 'Check-in failed.' });
      }
    } catch (e) {
      setCheckInMsg({ type: 'error', text: 'Error connecting to Reception Service.' });
    }
  };

  // Compute Checkout Receipt preview
  useEffect(() => {
    if (!checkoutRoom) {
      setCheckoutPreview(null);
      return;
    }
    const loadPreview = async () => {
      try {
        const queryParams = new URLSearchParams({
          room_number: String(checkoutRoom),
          late_checkout_hours: String(checkoutLateHours),
          minibar_charges: String(checkoutMinibar),
          discount_type: checkoutDiscountType,
          discount_value: String(checkoutDiscountVal)
        });
        const res = await fetch(`http://localhost:8001/api/reception/checkout/preview?${queryParams}`);
        if (res.ok) {
          setCheckoutPreview(await res.json());
        } else {
          setCheckoutPreview(null);
        }
      } catch (err) {
        console.error(err);
      }
    };
    loadPreview();
  }, [checkoutRoom, checkoutLateHours, checkoutMinibar, checkoutDiscountType, checkoutDiscountVal]);

  // Execute Checkout
  const handleCheckout = async (e: React.FormEvent) => {
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
          room_number: Number(checkoutRoom),
          late_checkout_hours: Number(checkoutLateHours),
          minibar_charges: Number(checkoutMinibar),
          discount_type: checkoutDiscountType,
          discount_value: Number(checkoutDiscountVal)
        })
      });
      const data = await res.json();
      if (res.ok) {
        setCheckoutMsg({ type: 'success', text: `Checkout complete for Room ${checkoutRoom}. Grand Total: $${data.billing.grand_total.toFixed(2)}` });
        setCheckoutRoom(null);
        setCheckoutMinibar(0);
        setCheckoutLateHours(0);
        setCheckoutDiscountType('none');
        setCheckoutDiscountVal(0);
        setCheckoutPreview(null);
      } else {
        setCheckoutMsg({ type: 'error', text: formatErrorDetail(data.detail) || 'Checkout failed.' });
      }
    } catch (e) {
      setCheckoutMsg({ type: 'error', text: 'Error connecting to Reception Service.' });
    }
  };

  // Housekeeping task transitions
  const startHousecleaning = async (taskId: number, roomNumber: number) => {
    const cleaner = assignHousekeeperName[roomNumber] || 'Standard Cleaner';
    try {
      const res = await fetch(`http://localhost:8002/api/housekeeping/tasks/${taskId}/start?housekeeper=${encodeURIComponent(cleaner)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const completeHousecleaning = async (taskId: number) => {
    try {
      const res = await fetch(`http://localhost:8002/api/housekeeping/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  // Maintenance issues updates
  const submitMaintenanceIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMaintenanceDesc) return;
    try {
      const res = await fetch('http://localhost:8004/api/maintenance/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_number: Number(newMaintenanceRoom),
          description: newMaintenanceDesc,
          urgency_level: newMaintenanceUrgency
        })
      });
      if (res.ok) {
        setNewMaintenanceDesc('');
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const resolveMaintenance = async (issueId: number) => {
    try {
      const res = await fetch(`http://localhost:8004/api/maintenance/issues/${issueId}/resolve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  // Room Service order lifecycle
  const advanceRoomServiceStatus = async (orderId: number, currentStatus: string) => {
    let nextStatus = 'Delivered';
    if (currentStatus === 'Received') nextStatus = 'Preparing';
    else if (currentStatus === 'Preparing') nextStatus = 'Out For Delivery';
    else if (currentStatus === 'Out For Delivery') nextStatus = 'Delivered';

    try {
      const res = await fetch(`http://localhost:8003/api/room-service/orders/${orderId}/status`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  // Filtered event lists for the terminal
  const filteredEvents = events.filter(ev => {
    if (filterService !== 'all' && !ev.event_type.startsWith(filterService)) return false;
    if (filterEventType !== 'all' && ev.event_type !== filterEventType) return false;
    return true;
  });

  // Calculate grid statistics
  const totalRooms = rooms.length;
  const countByStatus = (statusStr: string) => rooms.filter(r => r.status === statusStr).length;
  const cleanCount = countByStatus('Clean');
  const occupiedCount = countByStatus('Occupied');
  const dirtyCount = countByStatus('Dirty');
  const maintenanceCount = countByStatus('Maintenance');
  const cleaningCount = countByStatus('Being Cleaned');
  
  // Render login portal if unauthorized
  if (!token) {
    return (
      <div className="min-h-screen bg-[#070b13] flex items-center justify-center relative p-6">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 rounded-3xl p-8 backdrop-blur-xl shadow-2xl relative z-10 flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <span className="heading-font font-bold text-xl text-slate-950">H</span>
            </div>
            <h1 className="heading-font font-bold text-2xl text-slate-100">HotelOS Operations</h1>
            <p className="text-slate-400 text-sm">Administrative & Operations Staff Login Only</p>
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
              <div className="relative">
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 text-slate-200"
                />
              </div>
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
              className="mt-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-slate-950 font-bold heading-font flex items-center justify-center gap-2 hover:opacity-90 transition-all cursor-pointer shadow-lg shadow-cyan-500/10"
            >
              <KeyRound size={16} />
              Authenticate Session
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 flex flex-col justify-between selection:bg-cyan-500/30">
      
      {/* Background blobs */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center">
                <span className="heading-font font-bold text-slate-950">H</span>
              </div>
              <span className="heading-font font-bold text-lg tracking-wider">HotelOS</span>
            </div>
            
            <span className="hidden sm:inline-flex px-2.5 py-0.5 rounded-full bg-cyan-950/50 border border-cyan-800/40 text-cyan-400 text-[10px] font-bold tracking-widest uppercase">
              Staff Portal
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* WS status */}
            <div className="flex items-center gap-2 text-xs bg-slate-900/60 border border-slate-800 px-3 py-1.5 rounded-full">
              <span className={`w-2.5 h-2.5 rounded-full ${
                wsStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
                wsStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'
              }`} />
              <span className="text-slate-400 font-semibold">
                {wsStatus === 'connected' ? 'Live Broker Link' :
                 wsStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>

            <button 
              onClick={handleLogout}
              className="px-3.5 py-1.5 bg-slate-900 border border-slate-800 hover:border-rose-950 hover:bg-rose-950/20 text-slate-300 hover:text-rose-300 text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <LogOut size={14} />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-6 py-8 flex-grow w-full grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        
        {/* Left Column: Dashboards */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          
          {/* STATISTICS BAR */}
          <section className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-1 backdrop-blur-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-xl group-hover:scale-150 transition-all" />
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Ready / Clean</span>
              <span className="text-2xl font-bold text-cyan-400 heading-font">{cleanCount}</span>
              <span className="text-[10px] text-slate-400 font-semibold">{totalRooms ? ((cleanCount/totalRooms)*100).toFixed(0) : 0}% of rooms</span>
            </div>
            
            <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-1 backdrop-blur-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl group-hover:scale-150 transition-all" />
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Occupied</span>
              <span className="text-2xl font-bold text-emerald-400 heading-font">{occupiedCount}</span>
              <span className="text-[10px] text-slate-400 font-semibold">{totalRooms ? ((occupiedCount/totalRooms)*100).toFixed(0) : 0}% occupancy</span>
            </div>

            <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-1 backdrop-blur-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl group-hover:scale-150 transition-all" />
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Dirty</span>
              <span className="text-2xl font-bold text-amber-400 heading-font">{dirtyCount}</span>
              <span className="text-[10px] text-slate-400 font-semibold">{totalRooms ? ((dirtyCount/totalRooms)*100).toFixed(0) : 0}% laundry load</span>
            </div>

            <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-1 backdrop-blur-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/5 rounded-full blur-xl group-hover:scale-150 transition-all" />
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Cleaning</span>
              <span className="text-2xl font-bold text-violet-400 heading-font">{cleaningCount}</span>
              <span className="text-[10px] text-slate-400 font-semibold">Active workload</span>
            </div>

            <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-1 backdrop-blur-sm relative overflow-hidden group col-span-2 sm:col-span-1">
              <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-xl group-hover:scale-150 transition-all" />
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Maintenance</span>
              <span className="text-2xl font-bold text-rose-400 heading-font">{maintenanceCount}</span>
              <span className="text-[10px] text-slate-400 font-semibold">Out of order</span>
            </div>
          </section>

          {/* MAIN NAV TABS */}
          <div className="flex border-b border-slate-900 gap-1.5 overflow-x-auto pb-1">
            <button 
              onClick={() => setActiveTab('rooms')}
              className={`px-4 py-2 text-xs font-semibold heading-font rounded-lg flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                activeTab === 'rooms' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'text-slate-400 border border-transparent hover:text-slate-200'
              }`}
            >
              <LayoutGrid size={14} />
              Interactive Room Grid
            </button>
            <button 
              onClick={() => setActiveTab('reception')}
              className={`px-4 py-2 text-xs font-semibold heading-font rounded-lg flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                activeTab === 'reception' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'text-slate-400 border border-transparent hover:text-slate-200'
              }`}
            >
              <Users size={14} />
              Reception (Check-In/Out)
            </button>
            <button 
              onClick={() => setActiveTab('housekeeping')}
              className={`px-4 py-2 text-xs font-semibold heading-font rounded-lg flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                activeTab === 'housekeeping' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'text-slate-400 border border-transparent hover:text-slate-200'
              }`}
            >
              <ClipboardCheck size={14} />
              Housekeeping Queue
            </button>
            <button 
              onClick={() => setActiveTab('maintenance')}
              className={`px-4 py-2 text-xs font-semibold heading-font rounded-lg flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                activeTab === 'maintenance' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'text-slate-400 border border-transparent hover:text-slate-200'
              }`}
            >
              <Wrench size={14} />
              Maintenance Priority
            </button>
            <button 
              onClick={() => setActiveTab('roomservice')}
              className={`px-4 py-2 text-xs font-semibold heading-font rounded-lg flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                activeTab === 'roomservice' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'text-slate-400 border border-transparent hover:text-slate-200'
              }`}
            >
              <Coffee size={14} />
              Room Service Orders
            </button>
            <button 
              onClick={() => setActiveTab('audit')}
              className={`px-4 py-2 text-xs font-semibold heading-font rounded-lg flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                activeTab === 'audit' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'text-slate-400 border border-transparent hover:text-slate-200'
              }`}
            >
              <ScrollText size={14} />
              Audit Logs
            </button>
            <button 
              onClick={() => setActiveTab('staff')}
              className={`px-4 py-2 text-xs font-semibold heading-font rounded-lg flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                activeTab === 'staff' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'text-slate-400 border border-transparent hover:text-slate-200'
              }`}
            >
              <UserCheck size={14} />
              Staff Management
            </button>
          </div>

          {/* TAB CONTENTS */}
          <div className="flex-grow">
            
            {/* T-1: ROOM GRID */}
            {activeTab === 'rooms' && (
              <div className="flex flex-col gap-6">
                <div className="bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl">
                  <h2 className="heading-font font-bold text-lg mb-4 flex items-center gap-2">
                    <LayoutGrid size={18} className="text-cyan-500" />
                    Interactive Room Grid
                  </h2>
                  
                  {/* Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                    {rooms.map((room) => {
                      const guestInRoom = guests.find(g => g.room_number === room.room_number && g.status === 'CheckedIn');
                      
                      let bgClass = "border-slate-800 text-slate-400 bg-slate-950/20";
                      let statusBadge = "bg-slate-850 text-slate-400";
                      if (room.status === 'Clean') {
                        bgClass = "border-emerald-900/50 bg-emerald-950/10 text-emerald-300 shadow-md shadow-emerald-500/5 hover:border-emerald-600";
                        statusBadge = "bg-emerald-950 text-emerald-400 border border-emerald-800/50";
                      } else if (room.status === 'Occupied') {
                        bgClass = "border-cyan-900/50 bg-cyan-950/10 text-cyan-300 shadow-md shadow-cyan-500/5 hover:border-cyan-600";
                        statusBadge = "bg-cyan-950 text-cyan-400 border border-cyan-800/50";
                      } else if (room.status === 'Dirty') {
                        bgClass = "border-amber-900/50 bg-amber-950/10 text-amber-300 shadow-md shadow-amber-500/5 hover:border-amber-600";
                        statusBadge = "bg-amber-950 text-amber-400 border border-amber-800/50";
                      } else if (room.status === 'Being Cleaned') {
                        bgClass = "border-violet-900/50 bg-violet-950/10 text-violet-300 shadow-md shadow-violet-500/5 hover:border-violet-600 animate-pulse";
                        statusBadge = "bg-violet-950 text-violet-400 border border-violet-800/50";
                      } else if (room.status === 'Maintenance') {
                        bgClass = "border-rose-900/50 bg-rose-950/10 text-rose-300 shadow-md shadow-rose-500/5 hover:border-rose-600";
                        statusBadge = "bg-rose-950 text-rose-400 border border-rose-800/50";
                      }

                      return (
                        <div 
                          key={room.room_number} 
                          onClick={() => {
                            if (room.status === 'Occupied') {
                              setCheckoutRoom(room.room_number);
                              setActiveTab('reception');
                            }
                          }}
                          className={`border p-4 rounded-2xl flex flex-col justify-between gap-3 min-h-[140px] cursor-pointer transition-all hover:scale-[1.03] ${bgClass}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="heading-font font-bold text-xl">{room.room_number}</span>
                            <span className="text-[10px] font-semibold text-slate-500 tracking-wide uppercase">{room.room_type}</span>
                          </div>

                          <div className="flex flex-col gap-1">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full w-fit font-bold uppercase tracking-wider ${statusBadge}`}>
                              {room.status}
                            </span>
                            {guestInRoom && (
                              <span className="text-xs text-slate-200 font-semibold truncate flex items-center gap-1.5 mt-1">
                                <UserCheck size={12} className="text-cyan-500" />
                                {guestInRoom.name}
                              </span>
                            )}
                          </div>

                          <div className="text-[10px] text-slate-500 border-t border-slate-900/20 pt-1.5 flex items-center justify-between">
                            <span>Rate: ${room.nightly_rate}/n</span>
                            <span>Floor {room.floor}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* SERVICE STATS CARD */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-slate-900/20 border border-slate-800/60 p-4 rounded-xl flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-violet-950/50 border border-violet-800/30 flex items-center justify-center text-violet-400">
                      <ClipboardCheck size={20} />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase">Active Cleanings</h4>
                      <p className="text-lg font-bold text-slate-200">{housekeepingTasks.filter(t => t.status !== 'Finished').length} Tasks</p>
                    </div>
                  </div>
                  <div className="bg-slate-900/20 border border-slate-800/60 p-4 rounded-xl flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-rose-950/50 border border-rose-800/30 flex items-center justify-center text-rose-400">
                      <Wrench size={20} />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase">Pending Maintenance</h4>
                      <p className="text-lg font-bold text-slate-200">{maintenanceIssues.filter(i => i.status !== 'Resolved').length} Issues</p>
                    </div>
                  </div>
                  <div className="bg-slate-900/20 border border-slate-800/60 p-4 rounded-xl flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-950/50 border border-emerald-800/30 flex items-center justify-center text-emerald-400">
                      <Coffee size={20} />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase">Kitchen Orders</h4>
                      <p className="text-lg font-bold text-slate-200">{roomServiceOrders.filter(o => o.status !== 'Delivered').length} Active</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* T-2: RECEPTION */}
            {activeTab === 'reception' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Guest Check-In Form */}
                <div className="bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl flex flex-col gap-4">
                  <h3 className="heading-font font-bold text-lg flex items-center gap-2 border-b border-slate-800 pb-3">
                    <Users size={18} className="text-cyan-500" />
                    Guest Check-In Workflow
                  </h3>

                  {checkInMsg.text && (
                    <div className={`p-4 rounded-xl text-sm border ${
                      checkInMsg.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-rose-950/40 border-rose-800/50 text-rose-300'
                    }`}>
                      {checkInMsg.text}
                    </div>
                  )}

                  <form onSubmit={handleCheckIn} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-slate-400 font-semibold uppercase">Guest Full Name</label>
                      <input 
                        type="text" 
                        value={checkInName}
                        onChange={(e) => setCheckInName(e.target.value)}
                        placeholder="John Doe"
                        required
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-semibold uppercase">Room Type</label>
                        <select 
                          value={checkInType}
                          onChange={(e) => setCheckInType(e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                        >
                          <option>Single</option>
                          <option>Double</option>
                          <option>Accessible</option>
                          <option>Suite</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-semibold uppercase">Nights Stay</label>
                        <input 
                          type="number" 
                          value={checkInNights}
                          onChange={(e) => setCheckInNights(Math.max(1, Number(e.target.value)))}
                          min="1"
                          max="30"
                          required
                          className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-semibold uppercase">Floor Pref (Optional)</label>
                        <select 
                          value={checkInFloor === null ? '' : checkInFloor}
                          onChange={(e) => setCheckInFloor(e.target.value ? Number(e.target.value) : null)}
                          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                        >
                          <option value="">Any Floor</option>
                          <option value="1">Floor 1</option>
                          <option value="2">Floor 2</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-semibold uppercase">Proximity Pref (Optional)</label>
                        <select 
                          value={checkInProximity}
                          onChange={(e) => setCheckInProximity(e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                        >
                          <option>None</option>
                          <option>Near Elevator</option>
                          <option>Near Stairs</option>
                          <option>Away From Elevator</option>
                        </select>
                      </div>
                    </div>

                    <button 
                      type="submit" 
                      className="mt-2 py-3 rounded-xl bg-cyan-500 text-slate-950 heading-font font-bold flex items-center justify-center gap-1.5 hover:opacity-90 transition-all cursor-pointer"
                    >
                      <UserCheck size={16} />
                      Assign Optimal Room & Check-In
                    </button>
                  </form>
                </div>

                {/* Guest Checkout Form */}
                <div className="bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl flex flex-col gap-4">
                  <h3 className="heading-font font-bold text-lg flex items-center gap-2 border-b border-slate-800 pb-3">
                    <LogOut size={18} className="text-cyan-500" />
                    Guest Checkout & Billing
                  </h3>

                  {checkoutMsg.text && (
                    <div className={`p-4 rounded-xl text-sm border ${
                      checkoutMsg.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-rose-950/40 border-rose-800/50 text-rose-300'
                    }`}>
                      {checkoutMsg.text}
                    </div>
                  )}

                  <form onSubmit={handleCheckout} className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-semibold uppercase">Room Number</label>
                        <select 
                          value={checkoutRoom || ''} 
                          onChange={(e) => setCheckoutRoom(e.target.value ? Number(e.target.value) : null)}
                          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                        >
                          <option value="">Select Room</option>
                          {rooms.filter(r => r.status === 'Occupied').map(r => (
                            <option key={r.room_number} value={r.room_number}>Room {r.room_number}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-semibold uppercase">Minibar Charges ($)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          value={checkoutMinibar}
                          onChange={(e) => setCheckoutMinibar(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-semibold uppercase">Discount Type</label>
                        <select 
                          value={checkoutDiscountType}
                          onChange={(e) => setCheckoutDiscountType(e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                        >
                          <option value="none">No Discount</option>
                          <option value="fixed">Fixed ($)</option>
                          <option value="percentage">Percentage (%)</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-semibold uppercase">Discount Value</label>
                        <input 
                          type="number" 
                          step="0.01"
                          value={checkoutDiscountVal}
                          onChange={(e) => setCheckoutDiscountVal(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-slate-400 font-semibold uppercase">Late Checkout Hours</label>
                      <input 
                        type="number" 
                        value={checkoutLateHours}
                        onChange={(e) => setCheckoutLateHours(Math.max(0, Number(e.target.value) || 0))}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    {/* LIVE BILL PREVIEW */}
                    {checkoutPreview && (
                      <div className="bg-slate-950 p-4 border border-slate-800/80 rounded-xl flex flex-col gap-2.5 text-xs text-slate-400 font-mono">
                        <span className="text-[10px] text-cyan-400 font-bold tracking-wider uppercase border-b border-slate-800 pb-1.5 block">Live Bill Preview</span>
                        <div className="flex justify-between">
                          <span>Room Charges ({checkoutPreview.nights} nights):</span>
                          <span className="text-slate-200">${checkoutPreview.room_charges.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Room Service total:</span>
                          <span className="text-slate-200">${checkoutPreview.room_service_charges.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Minibar & Late Fees:</span>
                          <span className="text-slate-200">${(checkoutPreview.minibar_charges + checkoutPreview.late_checkout_fees).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-amber-400/80">
                          <span>Discount Applied:</span>
                          <span>-${checkoutPreview.discount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Tax (10% standard):</span>
                          <span className="text-slate-200">${checkoutPreview.tax.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-850 pt-2 text-sm text-slate-100 font-bold">
                          <span>GRAND TOTAL:</span>
                          <span className="text-cyan-400">${checkoutPreview.grand_total.toFixed(2)}</span>
                        </div>
                      </div>
                    )}

                    <button 
                      type="submit" 
                      disabled={!checkoutRoom}
                      className="mt-2 py-3 rounded-xl bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-100 heading-font font-bold flex items-center justify-center gap-1.5 hover:opacity-90 transition-all cursor-pointer"
                    >
                      <CheckCircle2 size={16} />
                      Complete Checkout (Vacate Room)
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* T-3: HOUSEKEEPING */}
            {activeTab === 'housekeeping' && (
              <div className="bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl">
                <h3 className="heading-font font-bold text-lg mb-6 flex items-center gap-2 border-b border-slate-800 pb-3">
                  <ClipboardCheck size={18} className="text-cyan-500" />
                  Housekeeping Queue
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* PENDING COLUMN */}
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        Pending
                      </span>
                      <span className="text-xs bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                        {housekeepingTasks.filter(t => t.status === 'Pending').length}
                      </span>
                    </div>

                    <div className="flex flex-col gap-3">
                      {housekeepingTasks.filter(t => t.status === 'Pending').map(task => (
                        <div key={task.id} className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
                          <div className="flex items-center justify-between">
                            <span className="heading-font font-bold text-lg text-slate-200">Room {task.room_number}</span>
                            <span className="text-[10px] text-slate-500">{new Date(task.created_at).toLocaleTimeString()}</span>
                          </div>
                          
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500 font-bold uppercase">Assign Housekeeper</label>
                            <input 
                              type="text" 
                              placeholder="Housekeeper Name"
                              value={assignHousekeeperName[task.room_number] || ''}
                              onChange={(e) => setAssignHousekeeperName({
                                ...assignHousekeeperName,
                                [task.room_number]: e.target.value
                              })}
                              className="bg-slate-900 border border-slate-800/80 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          <button 
                            onClick={() => startHousecleaning(task.id, task.room_number)}
                            className="py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold rounded-lg transition-all cursor-pointer"
                          >
                            Start Cleaning
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* IN PROGRESS COLUMN */}
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                        In Progress
                      </span>
                      <span className="text-xs bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                        {housekeepingTasks.filter(t => t.status === 'In Progress').length}
                      </span>
                    </div>

                    <div className="flex flex-col gap-3">
                      {housekeepingTasks.filter(t => t.status === 'In Progress').map(task => (
                        <div key={task.id} className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
                          <div className="flex items-center justify-between">
                            <span className="heading-font font-bold text-lg text-slate-200">Room {task.room_number}</span>
                            <span className="text-[10px] text-slate-500">{new Date(task.created_at).toLocaleTimeString()}</span>
                          </div>

                          <div className="text-xs text-slate-400">
                            Staff: <span className="font-semibold text-slate-200">{task.assigned_housekeeper}</span>
                          </div>

                          <button 
                            onClick={() => completeHousecleaning(task.id)}
                            className="py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-100 text-xs font-bold rounded-lg transition-all cursor-pointer"
                          >
                            Mark Clean
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* FINISHED COLUMN */}
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Finished
                      </span>
                      <span className="text-xs bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                        {housekeepingTasks.filter(t => t.status === 'Finished').length}
                      </span>
                    </div>

                    <div className="flex flex-col gap-3 opacity-60">
                      {housekeepingTasks.filter(t => t.status === 'Finished').slice(-5).map(task => (
                        <div key={task.id} className="bg-slate-950/20 border border-slate-800/40 p-4 rounded-xl flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <span className="heading-font font-bold text-base text-slate-300">Room {task.room_number}</span>
                            <span className="text-[10px] text-slate-500">Done</span>
                          </div>
                          <span className="text-[10px] text-slate-400">Housekeeper: {task.assigned_housekeeper}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* T-4: MAINTENANCE */}
            {activeTab === 'maintenance' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Create maintenance issue */}
                <div className="bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl flex flex-col gap-4 self-start">
                  <h3 className="heading-font font-bold text-lg flex items-center gap-2 border-b border-slate-800 pb-3">
                    <Wrench size={18} className="text-cyan-500" />
                    Report Maintenance Issue
                  </h3>

                  <form onSubmit={submitMaintenanceIssue} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-slate-400 font-semibold uppercase">Room Number</label>
                      <select 
                        value={newMaintenanceRoom} 
                        onChange={(e) => setNewMaintenanceRoom(Number(e.target.value))}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                      >
                        {rooms.map(r => (
                          <option key={r.room_number} value={r.room_number}>Room {r.room_number}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-slate-400 font-semibold uppercase">Urgency Level</label>
                      <select 
                        value={newMaintenanceUrgency} 
                        onChange={(e) => setNewMaintenanceUrgency(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                      >
                        <option>Critical</option>
                        <option>High</option>
                        <option>Normal</option>
                        <option>Low</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-slate-400 font-semibold uppercase">Issue Description</label>
                      <textarea 
                        value={newMaintenanceDesc} 
                        onChange={(e) => setNewMaintenanceDesc(e.target.value)}
                        placeholder="Leaking sink faucet, no hot water, etc."
                        required
                        rows={3}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    <button 
                      type="submit" 
                      className="py-3 rounded-xl bg-cyan-500 text-slate-950 heading-font font-bold flex items-center justify-center gap-1 hover:opacity-90 transition-all cursor-pointer"
                    >
                      Report & Queue Ticket
                    </button>
                  </form>
                </div>

                {/* Priority queue displays */}
                <div className="lg:col-span-2 bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl flex flex-col gap-4">
                  <h3 className="heading-font font-bold text-lg flex items-center gap-2 border-b border-slate-800 pb-3">
                    <ShieldAlert size={18} className="text-cyan-500" />
                    Maintenance Priority Board (heapq sorting)
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Active assigned issues */}
                    <div className="flex flex-col gap-4">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-2 block">
                        Assigned Work Orders
                      </span>

                      <div className="flex flex-col gap-3">
                        {maintenanceIssues.filter(i => i.status === 'Assigned').map(issue => (
                          <div key={issue.id} className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <span className="heading-font font-bold text-base text-slate-200">Room {issue.room_number}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                issue.priority === 1 ? 'bg-rose-950 text-rose-400 border border-rose-800/30' :
                                issue.priority === 2 ? 'bg-amber-950 text-amber-400 border border-amber-800/30' :
                                issue.priority === 3 ? 'bg-cyan-950 text-cyan-400 border border-cyan-800/30' :
                                'bg-slate-900 text-slate-400'
                              }`}>
                                {issue.priority === 1 ? 'CRITICAL' : issue.priority === 2 ? 'HIGH' : issue.priority === 3 ? 'NORMAL' : 'LOW'}
                              </span>
                            </div>

                            <p className="text-xs text-slate-400 leading-relaxed italic">"{issue.description}"</p>

                            <div className="text-xs text-slate-500 border-t border-slate-800 pt-2 flex items-center justify-between">
                              <span>Tech: <strong className="text-slate-300">{issue.assigned_technician}</strong></span>
                              <button 
                                onClick={() => resolveMaintenance(issue.id)}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-100 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                              >
                                Mark Resolved
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Pending queue */}
                    <div className="flex flex-col gap-4">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-2 block">
                        Waiting in Priority Queue (Heap List)
                      </span>

                      <div className="flex flex-col gap-3">
                        {maintenanceIssues.filter(i => i.status === 'Pending').map(issue => (
                          <div key={issue.id} className="bg-slate-950/20 border border-slate-850 p-4 rounded-xl flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <span className="heading-font font-bold text-sm text-slate-300">Room {issue.room_number}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                issue.priority === 1 ? 'bg-rose-950 text-rose-400' :
                                issue.priority === 2 ? 'bg-amber-950 text-amber-400' :
                                issue.priority === 3 ? 'bg-cyan-950 text-cyan-400' :
                                'bg-slate-900 text-slate-400'
                              }`}>
                                {issue.priority === 1 ? 'CRITICAL' : issue.priority === 2 ? 'HIGH' : issue.priority === 3 ? 'NORMAL' : 'LOW'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 truncate">"{issue.description}"</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* T-5: ROOM SERVICE */}
            {activeTab === 'roomservice' && (
              <div className="bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl">
                <h3 className="heading-font font-bold text-lg mb-6 flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Coffee size={18} className="text-cyan-500" />
                  Kitchen Room Service Order Queue
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  {['Received', 'Preparing', 'Out For Delivery', 'Delivered'].map(statusName => (
                    <div key={statusName} className="flex flex-col gap-4">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${
                            statusName === 'Received' ? 'bg-blue-500' :
                            statusName === 'Preparing' ? 'bg-amber-500 animate-pulse' :
                            statusName === 'Out For Delivery' ? 'bg-violet-500' : 'bg-emerald-500'
                          }`} />
                          {statusName}
                        </span>
                        <span className="text-xs bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                          {roomServiceOrders.filter(o => o.status === statusName).length}
                        </span>
                      </div>

                      <div className="flex flex-col gap-3">
                        {roomServiceOrders.filter(o => o.status === statusName).map(order => (
                          <div key={order.id} className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl flex flex-col gap-3">
                            <div className="flex items-center justify-between border-b border-slate-900/60 pb-1.5">
                              <span className="heading-font font-bold text-sm text-slate-200">Room {order.room_number}</span>
                              <span className="text-[10px] text-slate-500">#{order.id}</span>
                            </div>

                            <div className="flex flex-col gap-1 text-xs text-slate-400">
                              {parseItems(order.items).map((it, idx) => (
                                <div key={idx} className="flex justify-between">
                                  <span>{it.quantity}x {it.name}</span>
                                  <span className="text-slate-500">${(it.price * it.quantity).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>

                            <div className="border-t border-slate-900/60 pt-2 flex items-center justify-between">
                              <span className="text-xs font-bold text-cyan-400">${order.total_price.toFixed(2)}</span>
                              {statusName !== 'Delivered' && (
                                <button 
                                  onClick={() => advanceRoomServiceStatus(order.id, order.status)}
                                  className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-[10px] font-bold rounded transition-all cursor-pointer"
                                >
                                  {statusName === 'Received' ? 'Prepare' : statusName === 'Preparing' ? 'Deliver' : 'Done'}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* T-6: AUDIT LOG */}
            {activeTab === 'audit' && (
              <div className="bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl">
                <h3 className="heading-font font-bold text-lg mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
                  <ScrollText size={18} className="text-cyan-500" />
                  Audit Log System
                </h3>

                <div className="overflow-x-auto max-h-[480px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2.5 font-bold uppercase tracking-wider">Timestamp</th>
                        <th className="py-2.5 font-bold uppercase tracking-wider">Service</th>
                        <th className="py-2.5 font-bold uppercase tracking-wider">Event Type</th>
                        <th className="py-2.5 font-bold uppercase tracking-wider">Audit Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850/50">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-950/20 transition-all text-slate-300">
                          <td className="py-2.5 font-mono text-slate-500">{new Date(log.timestamp).toLocaleString()}</td>
                          <td className="py-2.5">
                            <span className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-850 text-slate-400 uppercase text-[9px] font-bold">
                              {log.service}
                            </span>
                          </td>
                          <td className="py-2.5 font-semibold text-cyan-400/90">{log.event_type}</td>
                          <td className="py-2.5 max-w-sm truncate text-slate-400 font-mono text-[11px]">{log.payload}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* T-7: STAFF MANAGEMENT */}
            {activeTab === 'staff' && (
              <div className="bg-slate-900/20 border border-slate-800/60 p-6 rounded-2xl flex flex-col gap-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="heading-font font-bold text-lg flex items-center gap-2">
                    <UserCheck size={18} className="text-cyan-500" />
                    Staff Management Panel
                  </h3>
                </div>

                {staffMsg.text && (
                  <div className={`text-sm p-4 rounded-xl border ${
                    staffMsg.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-rose-950/40 border-rose-800/50 text-rose-300'
                  }`}>
                    {staffMsg.text}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Create Staff Form */}
                  <div className="bg-slate-900/40 border border-slate-850 p-5 rounded-xl flex flex-col gap-4">
                    <h4 className="heading-font font-semibold text-sm text-slate-200">Register Staff Member</h4>
                    <form onSubmit={handleCreateStaff} className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-slate-400 font-bold uppercase">Username</label>
                        <input 
                          type="text" 
                          value={newStaffUsername}
                          onChange={(e) => setNewStaffUsername(e.target.value)}
                          placeholder="e.g. receptionist_john"
                          required
                          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 text-slate-200"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-slate-400 font-bold uppercase">Password</label>
                        <input 
                          type="password" 
                          value={newStaffPassword}
                          onChange={(e) => setNewStaffPassword(e.target.value)}
                          placeholder="Min 6 characters"
                          required
                          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 text-slate-200"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-slate-400 font-bold uppercase">Role</label>
                        <select 
                          value={newStaffRole}
                          onChange={(e) => setNewStaffRole(e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 text-slate-200"
                        >
                          <option value="receptionist">Receptionist</option>
                          <option value="housekeeper">Housekeeper</option>
                          <option value="maintenance">Maintenance</option>
                          <option value="kitchen_service">Kitchen Service</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                      </div>
                      <button 
                        type="submit"
                        className="mt-2 py-2 bg-gradient-to-r from-cyan-500 to-indigo-600 text-slate-950 rounded-lg text-xs font-bold hover:opacity-90 transition-all cursor-pointer shadow-lg shadow-cyan-500/10"
                      >
                        Register Member
                      </button>
                    </form>
                  </div>

                  {/* Staff List */}
                  <div className="md:col-span-2 bg-slate-900/40 border border-slate-850 p-5 rounded-xl">
                    <h4 className="heading-font font-semibold text-sm text-slate-200 mb-3">Active Staff Registry</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400">
                            <th className="py-2 font-bold uppercase tracking-wider">Username</th>
                            <th className="py-2 font-bold uppercase tracking-wider">Assigned Role</th>
                            <th className="py-2 text-right font-bold uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850/50">
                          {staffMembers.map((member) => (
                            <tr key={member.id} className="hover:bg-slate-950/20 text-slate-300">
                              <td className="py-3 font-semibold">{member.username}</td>
                              <td className="py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${
                                  member.role === 'super_admin' ? 'bg-indigo-950/50 border-indigo-800/30 text-indigo-400' :
                                  member.role === 'receptionist' ? 'bg-cyan-950/50 border-cyan-800/30 text-cyan-400' :
                                  member.role === 'housekeeper' ? 'bg-amber-950/50 border-amber-800/30 text-amber-400' :
                                  member.role === 'maintenance' ? 'bg-rose-950/50 border-rose-800/30 text-rose-400' :
                                  'bg-emerald-950/50 border-emerald-800/30 text-emerald-400'
                                }`}>
                                  {member.role.replace('_', ' ')}
                                </span>
                              </td>
                              <td className="py-3 text-right">
                                {member.username !== 'admin' ? (
                                  <button 
                                    onClick={() => handleDeleteStaff(member.id, member.username)}
                                    className="px-2 py-1 bg-rose-500/10 border border-rose-500/20 hover:border-rose-500/40 text-rose-400 hover:text-rose-300 rounded text-[10px] font-semibold cursor-pointer transition-all"
                                  >
                                    Delete
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-slate-500 italic">Protected</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Right Column: Event Log Broker Terminal */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <section className="bg-slate-950 border border-slate-900 rounded-3xl p-6 flex flex-col gap-4 h-[640px] shadow-2xl relative overflow-hidden flex-shrink-0">
            {/* Terminal Title */}
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-cyan-500" />
                <span className="heading-font font-bold text-sm text-slate-200">Event Broker Terminal</span>
              </div>
              
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={() => setPausedEvents(!pausedEvents)}
                  className={`p-1.5 rounded-lg border text-xs cursor-pointer ${
                    pausedEvents ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                  title={pausedEvents ? "Resume Event Stream" : "Pause Event Stream"}
                >
                  <Pause size={12} />
                </button>
                <button 
                  onClick={() => setEvents([])}
                  className="p-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 rounded-lg text-xs cursor-pointer"
                  title="Clear Console"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Filter selectors */}
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex flex-col gap-1">
                <span className="text-slate-500 font-bold uppercase">Service</span>
                <select 
                  value={filterService} 
                  onChange={(e) => setFilterService(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-slate-300 rounded p-1"
                >
                  <option value="all">All Services</option>
                  <option value="guest">guest</option>
                  <option value="room">room</option>
                  <option value="room_service">room_service</option>
                  <option value="maintenance">maintenance</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-slate-500 font-bold uppercase">Event Type</span>
                <select 
                  value={filterEventType} 
                  onChange={(e) => setFilterEventType(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-slate-300 rounded p-1"
                >
                  <option value="all">All Events</option>
                  <option value="guest.checked_in">guest.checked_in</option>
                  <option value="guest.checked_out">guest.checked_out</option>
                  <option value="room.vacated">room.vacated</option>
                  <option value="room.cleaning_started">room.cleaning_started</option>
                  <option value="room.cleaned">room.cleaned</option>
                  <option value="room.status_changed">room.status_changed</option>
                  <option value="room_service.created">room_service.created</option>
                  <option value="room_service.updated">room_service.updated</option>
                  <option value="maintenance.created">maintenance.created</option>
                  <option value="maintenance.assigned">maintenance.assigned</option>
                  <option value="maintenance.resolved">maintenance.resolved</option>
                </select>
              </div>
            </div>

            {/* Stream Console */}
            <div className="flex-grow bg-[#05070c] border border-[#0d121f] rounded-2xl p-4 overflow-y-auto font-mono text-[10px] flex flex-col gap-3.5 scrollbar-thin scrollbar-thumb-slate-800">
              {filteredEvents.length === 0 ? (
                <div className="text-slate-600 text-center py-12 italic">Waiting for events from Redis Pub/Sub...</div>
              ) : (
                filteredEvents.map((ev, index) => (
                  <div key={index} className="border-b border-slate-900 pb-2.5 flex flex-col gap-1 last:border-b-0">
                    <div className="flex items-center justify-between text-slate-500 text-[9px]">
                      <span>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                      <span className="text-cyan-500/80 font-bold">{ev.event_type}</span>
                    </div>
                    <div className="text-slate-400 font-semibold truncate">
                      Event ID: <span className="text-slate-500">{ev.event_id.substring(0, 8)}...</span>
                    </div>
                    {/* JSON viewer syntax highlighted effect */}
                    <pre className="text-emerald-400 bg-slate-950/40 p-2 rounded border border-slate-900/60 overflow-x-auto text-[9px] max-h-24">
                      {JSON.stringify(ev.payload, null, 2)}
                    </pre>
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
            
            {pausedEvents && (
              <div className="absolute bottom-6 left-6 right-6 bg-cyan-950 border border-cyan-800/40 text-cyan-400 px-4 py-2 rounded-xl text-center text-xs font-semibold animate-pulse">
                Terminal Stream Paused
              </div>
            )}
          </section>
        </div>

      </div>

      {/* Footer */}
      <footer className="border-t border-slate-950 bg-slate-950 py-4 text-center text-xs text-slate-600">
        <p>© 2026 HotelOS System Operations. Microservices & WebSockets Console. All Rights Reserved.</p>
      </footer>

    </div>
  );
}

export default App;
