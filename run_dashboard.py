import subprocess
import sys
import os
import time
import signal

# Configurations
SERVICES = {
    "Reception Service": {"cmd": [sys.executable, "-m", "backend.reception.main"], "port": 8001},
    "Housekeeping Service": {"cmd": [sys.executable, "-m", "backend.housekeeping.main"], "port": 8002},
    "Room Service": {"cmd": [sys.executable, "-m", "backend.room_service.main"], "port": 8003},
    "Maintenance Service": {"cmd": [sys.executable, "-m", "backend.maintenance.main"], "port": 8004},
    "Notification Gateway": {"cmd": [sys.executable, "-m", "backend.notification_gateway.main"], "port": 8005},
    "Operations Portal": {"cmd": ["npm", "run", "dev", "--workspace=frontend/operations"], "port": 3000},
    "Guest Portal": {"cmd": ["npm", "run", "dev", "--workspace=frontend/guest"], "port": 3001},
    "Landing Portal": {"cmd": ["npm", "run", "dev", "--workspace=frontend/landing"], "port": 3002},
    "Receptionist Portal": {"cmd": ["npm", "run", "dev", "--workspace=frontend/receptionist"], "port": 3003},
    "Housekeeper Portal": {"cmd": ["npm", "run", "dev", "--workspace=frontend/housekeeper"], "port": 3004},
    "Maintenance Portal": {"cmd": ["npm", "run", "dev", "--workspace=frontend/maintenance"], "port": 3005},
    "Kitchen Portal": {"cmd": ["npm", "run", "dev", "--workspace=frontend/kitchen"], "port": 3006},
}

running_processes = {}

def ensure_redis():
    """Starts Redis alpine container. Cleans up existing containers if needed."""
    print("[Orchestrator] Setting up Redis Service...")
    # Check if Docker is running
    try:
        res = subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode != 0:
            print("[Warning] Docker daemon is not running. Please launch Docker Desktop.")
            return False
    except Exception:
        print("[Warning] Docker CLI not found. Skipping Redis setup.")
        return False

    # Stop and remove existing container if running
    subprocess.run(["docker", "rm", "-f", "hotelos-redis"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # Run container
    try:
        subprocess.run([
            "docker", "run", "--name", "hotelos-redis",
            "-p", "6379:6379", "-d", "redis:alpine"
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("[Orchestrator] Redis docker container (hotelos-redis) running on port 6379!")
        return True
    except Exception as e:
        print(f"[Warning] Failed to launch Redis container: {e}")
        return False

def ensure_npm_install():
    """Runs npm install at root to ensure monorepo frontend dependencies are set up."""
    if not os.path.exists("node_modules"):
        print("[Orchestrator] node_modules not found. Executing npm install...")
        # On windows we need shell=True for npm commands
        subprocess.run("npm install", shell=True)
        print("[Orchestrator] Dependencies installed!")
    else:
        print("[Orchestrator] node_modules found. Skipping npm install.")

def start_process(name, config):
    """Launches a microservice or portal process and captures logs."""
    cmd = config["cmd"]
    print(f"[Orchestrator] Launching {name}...")
    
    # On Windows, npm commands require shell=True
    is_shell = cmd[0] == "npm"
    
    try:
        p = subprocess.Popen(
            cmd if not is_shell else " ".join(cmd),
            shell=is_shell,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        running_processes[name] = p
        
        # Spawn log reader thread
        import threading
        def log_reader(proc, prefix):
            while True:
                line = proc.stdout.readline()
                if not line:
                    break
                print(f"[{prefix}] {line.strip()}")
                
        threading.Thread(target=log_reader, args=(p, name), daemon=True).start()
    except Exception as e:
        print(f"[Error] Failed to start {name}: {e}")

def shutdown_all():
    """Gracefully terminates all child processes and stops Redis."""
    print("\n[Orchestrator] Shutting down all services...")
    for name, proc in list(running_processes.items()):
        print(f"[Orchestrator] Terminating {name}...")
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    
    print("[Orchestrator] Stopping Redis docker container...")
    subprocess.run(["docker", "stop", "hotelos-redis"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("[Orchestrator] Clean shutdown complete!")

def main():
    print("==================================================")
    print("     HOTELOS SERVICE ORCHESTRATOR LAUNCHER        ")
    print("==================================================")
    
    # Enable CTRL+C cleanup
    def signal_handler(sig, frame):
        shutdown_all()
        sys.exit(0)
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # 1. Run Redis
    ensure_redis()
    
    # 2. Run npm install
    ensure_npm_install()
    
    # 3. Launch all processes
    for name, config in SERVICES.items():
        start_process(name, config)
        time.sleep(1) # Stagger boot up times
        
    print("\n[Orchestrator] All systems running! Listening for crashes...")
    
    # 4. Monitoring loop with auto-restart capability
    while True:
        try:
            time.sleep(3)
            for name, proc in list(running_processes.items()):
                poll = proc.poll()
                if poll is not None:
                    print(f"[Orchestrator Warning] {name} exited with code {poll}! Restarting...")
                    start_process(name, SERVICES[name])
        except KeyboardInterrupt:
            break
            
    shutdown_all()

if __name__ == "__main__":
    main()
