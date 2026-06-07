import { Activity, ShieldAlert, Coffee, ClipboardCheck, Server, Database, ActivitySquare } from 'lucide-react';

function App() {
  const launchPortal = (port: number) => {
    window.open(`http://localhost:${port}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-cyan-500 selection:text-slate-900">
      
      {/* Background decoration */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <span className="heading-font font-bold text-lg text-slate-950">H</span>
            </div>
            <span className="heading-font font-bold text-xl tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400">HotelOS</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span className="flex items-center gap-1.5"><ActivitySquare size={14} className="text-cyan-500 animate-pulse" /> Live Gateway Connected</span>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-6xl mx-auto px-6 py-12 flex-grow flex flex-col justify-center gap-12 relative z-10">
        <div className="text-center max-w-3xl mx-auto flex flex-col gap-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/50 border border-cyan-800/50 text-cyan-400 text-xs font-semibold self-center tracking-wide uppercase">
            University Assignment Submission
          </div>
          
          <h1 className="heading-font font-bold text-4xl sm:text-6xl tracking-tight leading-tight">
            Real-Time Hotel Operations <br/>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-indigo-400">
              Reimagined with Events
            </span>
          </h1>

          <p className="text-slate-400 text-base sm:text-lg leading-relaxed">
            An advanced microservices-driven hotel management system executing check-ins, housekeeping task tracking, room service deques, and priority maintenance queues over a Redis event broker.
          </p>

          {/* Access Portals Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mt-6">
            {/* Super Admin */}
            <div 
              onClick={() => launchPortal(3000)}
              className="bg-slate-900/40 border border-slate-800 hover:border-cyan-500/40 p-5 rounded-2xl flex flex-col gap-3 transition-all hover:scale-[1.02] cursor-pointer shadow-lg hover:shadow-cyan-500/5 group text-left"
            >
              <div className="flex items-center justify-between">
                <span className="heading-font font-bold text-slate-200 group-hover:text-cyan-400">Super Admin Portal</span>
                <span className="text-[10px] text-cyan-400 font-mono border border-cyan-800/40 px-2 py-0.5 rounded-full">Port 3000</span>
              </div>
              <p className="text-xs text-slate-400">Full operations dashboard, all microservice tabs, and staff crud management.</p>
              <span className="text-[10px] text-slate-500 italic mt-auto">Credentials: admin / hotelos123</span>
            </div>

            {/* Guest Portal */}
            <div 
              onClick={() => launchPortal(3001)}
              className="bg-slate-900/40 border border-slate-800 hover:border-indigo-500/40 p-5 rounded-2xl flex flex-col gap-3 transition-all hover:scale-[1.02] cursor-pointer shadow-lg hover:shadow-indigo-500/5 group text-left"
            >
              <div className="flex items-center justify-between">
                <span className="heading-font font-bold text-slate-200 group-hover:text-indigo-400">Guest Portal</span>
                <span className="text-[10px] text-indigo-400 font-mono border border-indigo-800/40 px-2 py-0.5 rounded-full">Port 3001</span>
              </div>
              <p className="text-xs text-slate-400">For checked-in guests. Request minibar food/drinks, view charges, report issues.</p>
              <span className="text-[10px] text-slate-500 italic mt-auto">Login via active reservation code</span>
            </div>

            {/* Receptionist Portal */}
            <div 
              onClick={() => launchPortal(3003)}
              className="bg-slate-900/40 border border-slate-800 hover:border-cyan-500/40 p-5 rounded-2xl flex flex-col gap-3 transition-all hover:scale-[1.02] cursor-pointer shadow-lg hover:shadow-cyan-500/5 group text-left"
            >
              <div className="flex items-center justify-between">
                <span className="heading-font font-bold text-slate-200 group-hover:text-cyan-400">Receptionist Portal</span>
                <span className="text-[10px] text-cyan-400 font-mono border border-cyan-800/40 px-2 py-0.5 rounded-full">Port 3003</span>
              </div>
              <p className="text-xs text-slate-400">Check-in guests using floor/elevator filters; checkout with receipt previews.</p>
              <span className="text-[10px] text-slate-500 italic mt-auto">Credentials: recep1 / hotelos123</span>
            </div>

            {/* Housekeeper Portal */}
            <div 
              onClick={() => launchPortal(3004)}
              className="bg-slate-900/40 border border-slate-800 hover:border-amber-500/40 p-5 rounded-2xl flex flex-col gap-3 transition-all hover:scale-[1.02] cursor-pointer shadow-lg hover:shadow-amber-500/5 group text-left"
            >
              <div className="flex items-center justify-between">
                <span className="heading-font font-bold text-slate-200 group-hover:text-amber-400">Housekeeper Portal</span>
                <span className="text-[10px] text-amber-400 font-mono border border-amber-800/40 px-2 py-0.5 rounded-full">Port 3004</span>
              </div>
              <p className="text-xs text-slate-400">Interactive cleaning tasks list with live start/complete performance timers.</p>
              <span className="text-[10px] text-slate-500 italic mt-auto">Credentials: house1 / hotelos123</span>
            </div>

            {/* Maintenance Portal */}
            <div 
              onClick={() => launchPortal(3005)}
              className="bg-slate-900/40 border border-slate-800 hover:border-rose-500/40 p-5 rounded-2xl flex flex-col gap-3 transition-all hover:scale-[1.02] cursor-pointer shadow-lg hover:shadow-rose-500/5 group text-left"
            >
              <div className="flex items-center justify-between">
                <span className="heading-font font-bold text-slate-200 group-hover:text-rose-400">Maintenance Portal</span>
                <span className="text-[10px] text-rose-450 font-mono border border-rose-800/40 px-2 py-0.5 rounded-full">Port 3005</span>
              </div>
              <p className="text-xs text-slate-400">Work order tickets with active repair timers, before-photos, and after resolution uploads.</p>
              <span className="text-[10px] text-slate-500 italic mt-auto">Credentials: tech1 / hotelos123</span>
            </div>

            {/* Kitchen Portal */}
            <div 
              onClick={() => launchPortal(3006)}
              className="bg-slate-900/40 border border-slate-800 hover:border-emerald-500/40 p-5 rounded-2xl flex flex-col gap-3 transition-all hover:scale-[1.02] cursor-pointer shadow-lg hover:shadow-emerald-500/5 group text-left"
            >
              <div className="flex items-center justify-between">
                <span className="heading-font font-bold text-slate-200 group-hover:text-emerald-400">Kitchen Portal</span>
                <span className="text-[10px] text-emerald-400 font-mono border border-emerald-800/40 px-2 py-0.5 rounded-full">Port 3006</span>
              </div>
              <p className="text-xs text-slate-400">FIFO kitchen food order preparation queue with active order room indicator grid.</p>
              <span className="text-[10px] text-slate-500 italic mt-auto">Credentials: chef1 / hotelos123</span>
            </div>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-6">
          <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl flex flex-col gap-4 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-cyan-950/50 border border-cyan-800/30 flex items-center justify-center text-cyan-400">
              <ClipboardCheck size={20} />
            </div>
            <h3 className="heading-font font-bold text-lg text-slate-200">Reception & Booking</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Automatic room selection based on nightly availability, floor filters, cleanliness age, and elevator proximity.
            </p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl flex flex-col gap-4 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-indigo-950/50 border border-indigo-800/30 flex items-center justify-center text-indigo-400">
              <Activity size={20} />
            </div>
            <h3 className="heading-font font-bold text-lg text-slate-200">Housekeeping</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Listen to vacated events and manage cleanings through dirty, being cleaned, and cleaned states.
            </p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl flex flex-col gap-4 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/50 border border-emerald-800/30 flex items-center justify-center text-emerald-400">
              <Coffee size={20} />
            </div>
            <h3 className="heading-font font-bold text-lg text-slate-200">Room Service</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Order drinks, food, and track kitchen queues utilizing custom Python deque structures.
            </p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl flex flex-col gap-4 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-rose-950/50 border border-rose-800/30 flex items-center justify-center text-rose-400">
              <ShieldAlert size={20} />
            </div>
            <h3 className="heading-font font-bold text-lg text-slate-200">Maintenance</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Report issues and assign technicians according to heapq priority queues.
            </p>
          </div>
        </div>

        {/* System Architecture Specifications */}
        <div className="bg-slate-900/20 border border-slate-800/60 p-8 rounded-3xl flex flex-col gap-6 mt-4">
          <h2 className="heading-font font-bold text-xl text-center text-slate-300">Technical Specifications</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-500 font-semibold tracking-wider uppercase">Message Broker</span>
              <span className="text-sm font-semibold text-cyan-400 flex items-center justify-center gap-1"><Server size={14} /> Redis Pub/Sub</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-500 font-semibold tracking-wider uppercase">Database Engine</span>
              <span className="text-sm font-semibold text-cyan-400 flex items-center justify-center gap-1"><Database size={14} /> SQLite WAL Mode</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-500 font-semibold tracking-wider uppercase">API Backend</span>
              <span className="text-sm font-semibold text-cyan-400">FastAPI (5 Services)</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-500 font-semibold tracking-wider uppercase">Real-Time Streams</span>
              <span className="text-sm font-semibold text-cyan-400">WebSockets Gateway</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-600">
        <p>© 2026 HotelOS System Operations. Level 4 Programming Assignment Implementation. All Rights Reserved.</p>
      </footer>
    </div>
  );
}

export default App;
