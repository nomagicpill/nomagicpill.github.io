// Moshpit Simulation - 3D model of heads and fists with collision detection
// Uses Three.js for 3D rendering and physics

// Constants for simulation
const SIMULATION_DURATION = 30; // seconds
const NUM_HEADS = 15;
const NUM_FISTS = 30;
const HEAD_RADIUS = 0.3;
const FIST_RADIUS = 0.1;
const FLOOR_HEIGHT = 0;
const HEAD_HEIGHT_RANGE = { min: 1.6, max: 1.9 }; // Height range for heads
const FIST_HEIGHT_RANGE = { min: 0.8, max: 2.0 }; // Height range for fists
const GROUND_SIZE = 10; // Size of the moshpit ground area
const MAX_VELOCITY = 2.0; // Maximum velocity of entities
const MIN_VELOCITY = 0.5; // Minimum velocity of entities
const VELOCITY_CHANGE_INTERVAL = 1000; // ms between velocity changes
const COLLISION_COOLDOWN = 200; // ms between possible collisions for same pair

// Main simulation class
class MoshpitSimulation {
  constructor() {
    this.initThree();
    this.initEntities();
    this.collisionCount = 0;
    this.elapsedTime = 0;
    this.collisionCooldowns = new Map(); // Track recent collisions
    this.running = false;
    this.setupEventListeners();
  }

  // Initialize Three.js scene
  initThree() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404040);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    this.scene.add(directionalLight);

    // Add floor
    const floorGeometry = new THREE.PlaneGeometry(GROUND_SIZE * 2, GROUND_SIZE * 2);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_HEIGHT;
    this.scene.add(floor);

    // Position camera
    this.camera.position.set(0, 4, 8);
    this.camera.lookAt(0, 1, 0);

    // Add orbit controls for interactive viewing
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
  }

  // Create heads and fists
  initEntities() {
    this.heads = [];
    this.fists = [];

    const headGeometry = new THREE.SphereGeometry(HEAD_RADIUS, 32, 32);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xffaa00 });

    const fistGeometry = new THREE.SphereGeometry(FIST_RADIUS, 16, 16);
    const fistMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });

    // Create heads
    for (let i = 0; i < NUM_HEADS; i++) {
      const head = new THREE.Mesh(headGeometry, headMaterial);
      
      // Random position
      head.position.x = (Math.random() - 0.5) * GROUND_SIZE;
      head.position.z = (Math.random() - 0.5) * GROUND_SIZE;
      head.position.y = HEAD_HEIGHT_RANGE.min + Math.random() * (HEAD_HEIGHT_RANGE.max - HEAD_HEIGHT_RANGE.min);
      
      // Random velocity
      head.velocity = {
        x: this.getRandomVelocity(),
        y: 0, // Heads stay at roughly the same height
        z: this.getRandomVelocity()
      };
      
      this.scene.add(head);
      this.heads.push(head);
    }

    // Create fists
    for (let i = 0; i < NUM_FISTS; i++) {
      const fist = new THREE.Mesh(fistGeometry, fistMaterial);
      
      // Random position
      fist.position.x = (Math.random() - 0.5) * GROUND_SIZE;
      fist.position.z = (Math.random() - 0.5) * GROUND_SIZE;
      fist.position.y = FIST_HEIGHT_RANGE.min + Math.random() * (FIST_HEIGHT_RANGE.max - FIST_HEIGHT_RANGE.min);
      
      // Random velocity
      fist.velocity = {
        x: this.getRandomVelocity(),
        y: this.getRandomVelocity() * 0.5, // Vertical movement is slower
        z: this.getRandomVelocity()
      };
      
      this.scene.add(fist);
      this.fists.push(fist);
    }
  }

  // Generate random velocity within range
  getRandomVelocity() {
    return (Math.random() * (MAX_VELOCITY - MIN_VELOCITY) + MIN_VELOCITY) * (Math.random() > 0.5 ? 1 : -1);
  }

  // Set up event listeners
  setupEventListeners() {
    // Resize handler
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Create UI elements
    this.setupUI();
  }

  // Create UI for displaying stats and controls
  setupUI() {
    const statsDiv = document.createElement('div');
    statsDiv.style.position = 'absolute';
    statsDiv.style.top = '10px';
    statsDiv.style.left = '10px';
    statsDiv.style.padding = '10px';
    statsDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    statsDiv.style.color = 'white';
    statsDiv.style.fontFamily = 'Arial, sans-serif';
    statsDiv.style.borderRadius = '5px';
    document.body.appendChild(statsDiv);

    this.statsElement = document.createElement('div');
    statsDiv.appendChild(this.statsElement);

    // Add controls
    const controlsDiv = document.createElement('div');
    controlsDiv.style.marginTop = '10px';
    
    const startButton = document.createElement('button');
    startButton.textContent = 'Start';
    startButton.style.marginRight = '10px';
    startButton.addEventListener('click', () => this.startSimulation());
    
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset';
    resetButton.addEventListener('click', () => this.resetSimulation());
    
    controlsDiv.appendChild(startButton);
    controlsDiv.appendChild(resetButton);
    statsDiv.appendChild(controlsDiv);
    
    this.updateStats();
  }

  // Update stats display
  updateStats() {
    if (this.statsElement) {
      this.statsElement.innerHTML = `
        Entities: ${NUM_HEADS} heads, ${NUM_FISTS} fists<br>
        Collisions: ${this.collisionCount}<br>
        Time: ${this.elapsedTime.toFixed(1)}s / ${SIMULATION_DURATION}s
      `;
    }
  }

  // Start the simulation
  startSimulation() {
    if (!this.running) {
      this.running = true;
      this.lastTime = performance.now();
      this.animate();
      
      // Set up random velocity changes
      this.velocityChangeInterval = setInterval(() => {
        // Randomly change velocities of some entities
        this.heads.forEach(head => {
          if (Math.random() < 0.2) {
            head.velocity.x = this.getRandomVelocity();
            head.velocity.z = this.getRandomVelocity();
          }
        });
        
        this.fists.forEach(fist => {
          if (Math.random() < 0.3) {
            fist.velocity.x = this.getRandomVelocity();
            fist.velocity.y = this.getRandomVelocity() * 0.5;
            fist.velocity.z = this.getRandomVelocity();
          }
        });
      }, VELOCITY_CHANGE_INTERVAL);
    }
  }

  // Reset the simulation
  resetSimulation() {
    this.running = false;
    if (this.velocityChangeInterval) {
      clearInterval(this.velocityChangeInterval);
    }
    
    // Reset positions and velocities
    this.scene.remove(...this.heads, ...this.fists);
    this.initEntities();
    
    // Reset counters
    this.collisionCount = 0;
    this.elapsedTime = 0;
    this.collisionCooldowns.clear();
    
    this.updateStats();
  }

  // Animation loop
  animate() {
    if (!this.running) return;

    const now = performance.now();
    const deltaTime = (now - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = now;
    
    this.elapsedTime += deltaTime;
    
    // Update entity positions
    this.updateEntities(deltaTime);
    
    // Check for collisions
    this.detectCollisions();
    
    // Update the stats display
    this.updateStats();
    
    // Render the scene
    this.renderer.render(this.scene, this.camera);
    
    // Request next frame if simulation is still running
    if (this.elapsedTime < SIMULATION_DURATION && this.running) {
      requestAnimationFrame(() => this.animate());
    } else if (this.elapsedTime >= SIMULATION_DURATION) {
      this.running = false;
      console.log(`Simulation complete. Total collisions: ${this.collisionCount}`);
    }
  }

  // Update positions of all entities
  updateEntities(deltaTime) {
    // Update heads
    this.heads.forEach(head => {
      head.position.x += head.velocity.x * deltaTime;
      head.position.z += head.velocity.z * deltaTime;
      
      // Bounce off walls
      if (Math.abs(head.position.x) > GROUND_SIZE / 2) {
        head.velocity.x *= -1;
        head.position.x = Math.sign(head.position.x) * GROUND_SIZE / 2;
      }
      
      if (Math.abs(head.position.z) > GROUND_SIZE / 2) {
        head.velocity.z *= -1;
        head.position.z = Math.sign(head.position.z) * GROUND_SIZE / 2;
      }
    });
    
    // Update fists
    this.fists.forEach(fist => {
      fist.position.x += fist.velocity.x * deltaTime;
      fist.position.y += fist.velocity.y * deltaTime;
      fist.position.z += fist.velocity.z * deltaTime;
      
      // Bounce off walls
      if (Math.abs(fist.position.x) > GROUND_SIZE / 2) {
        fist.velocity.x *= -1;
        fist.position.x = Math.sign(fist.position.x) * GROUND_SIZE / 2;
      }
      
      if (Math.abs(fist.position.z) > GROUND_SIZE / 2) {
        fist.velocity.z *= -1;
        fist.position.z = Math.sign(fist.position.z) * GROUND_SIZE / 2;
      }
      
      // Bounce off floor and ceiling
      if (fist.position.y < FIST_HEIGHT_RANGE.min || fist.position.y > FIST_HEIGHT_RANGE.max) {
        fist.velocity.y *= -1;
        fist.position.y = fist.position.y < FIST_HEIGHT_RANGE.min ? 
          FIST_HEIGHT_RANGE.min : FIST_HEIGHT_RANGE.max;
      }
    });
  }

  // Detect collisions between entities
  detectCollisions() {
    const now = performance.now();
    
    // Check for head-fist collisions
    this.heads.forEach((head, headIndex) => {
      this.fists.forEach((fist, fistIndex) => {
        const collisionId = `h${headIndex}-f${fistIndex}`;
        const lastCollision = this.collisionCooldowns.get(collisionId) || 0;
        
        // Skip if this pair recently collided
        if (now - lastCollision < COLLISION_COOLDOWN) return;
        
        // Calculate distance between head and fist
        const dx = head.position.x - fist.position.x;
        const dy = head.position.y - fist.position.y;
        const dz = head.position.z - fist.position.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Check for collision
        if (distance < HEAD_RADIUS + FIST_RADIUS) {
          this.collisionCount++;
          this.collisionCooldowns.set(collisionId, now);
          
          // Visualize collision with a flash
          this.createCollisionFlash(
            (head.position.x + fist.position.x) / 2,
            (head.position.y + fist.position.y) / 2,
            (head.position.z + fist.position.z) / 2
          );
          
          // Apply simple physics - bounce off each other
          const nx = dx / distance;
          const ny = dy / distance;
          const nz = dz / distance;
          
          // Adjust velocities (simple reflection)
          fist.velocity.x = -fist.velocity.x + nx * 0.5;
          fist.velocity.y = -fist.velocity.y + ny * 0.5;
          fist.velocity.z = -fist.velocity.z + nz * 0.5;
          
          head.velocity.x = -head.velocity.x + nx * 0.2;
          head.velocity.z = -head.velocity.z + nz * 0.2;
        }
      });
    });
    
    // Check for head-head collisions
    for (let i = 0; i < this.heads.length; i++) {
      for (let j = i + 1; j < this.heads.length; j++) {
        const head1 = this.heads[i];
        const head2 = this.heads[j];
        const collisionId = `h${i}-h${j}`;
        const lastCollision = this.collisionCooldowns.get(collisionId) || 0;
        
        // Skip if this pair recently collided
        if (now - lastCollision < COLLISION_COOLDOWN) continue;
        
        // Calculate distance between heads
        const dx = head1.position.x - head2.position.x;
        const dy = head1.position.y - head2.position.y;
        const dz = head1.position.z - head2.position.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Check for collision
        if (distance < HEAD_RADIUS * 2) {
          this.collisionCount++;
          this.collisionCooldowns.set(collisionId, now);
          
          // Create visual effect
          this.createCollisionFlash(
            (head1.position.x + head2.position.x) / 2,
            (head1.position.y + head2.position.y) / 2,
            (head1.position.z + head2.position.z) / 2
          );
          
          // Apply simple physics - bounce off each other
          const nx = dx / distance;
          const ny = dy / distance;
          const nz = dz / distance;
          
          // Exchange velocities (simplified)
          const temp = {
            x: head1.velocity.x,
            z: head1.velocity.z
          };
          
          head1.velocity.x = head2.velocity.x + nx * 0.5;
          head1.velocity.z = head2.velocity.z + nz * 0.5;
          
          head2.velocity.x = temp.x - nx * 0.5;
          head2.velocity.z = temp.z - nz * 0.5;
        }
      });
    }
    
    // Check for fist-fist collisions
    for (let i = 0; i < this.fists.length; i++) {
      for (let j = i + 1; j < this.fists.length; j++) {
        const fist1 = this.fists[i];
        const fist2 = this.fists[j];
        const collisionId = `f${i}-f${j}`;
        const lastCollision = this.collisionCooldowns.get(collisionId) || 0;
        
        // Skip if this pair recently collided
        if (now - lastCollision < COLLISION_COOLDOWN) continue;
        
        // Calculate distance between fists
        const dx = fist1.position.x - fist2.position.x;
        const dy = fist1.position.y - fist2.position.y;
        const dz = fist1.position.z - fist2.position.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Check for collision
        if (distance < FIST_RADIUS * 2) {
          this.collisionCount++;
          this.collisionCooldowns.set(collisionId, now);
          
          // Create visual effect
          this.createCollisionFlash(
            (fist1.position.x + fist2.position.x) / 2,
            (fist1.position.y + fist2.position.y) / 2,
            (fist1.position.z + fist2.position.z) / 2
          );
          
          // Apply simple physics - bounce off each other
          const nx = dx / distance;
          const ny = dy / distance;
          const nz = dz / distance;
          
          // Exchange velocities (simplified)
          const temp = {
            x: fist1.velocity.x,
            y: fist1.velocity.y,
            z: fist1.velocity.z
          };
          
          fist1.velocity.x = fist2.velocity.x + nx * 0.5;
          fist1.velocity.y = fist2.velocity.y + ny * 0.5;
          fist1.velocity.z = fist2.velocity.z + nz * 0.5;
          
          fist2.velocity.x = temp.x - nx * 0.5;
          fist2.velocity.y = temp.y - ny * 0.5;
          fist2.velocity.z = temp.z - nz * 0.5;
        }
      });
    }
  }

  // Create visual flash effect for collisions
  createCollisionFlash(x, y, z) {
    const flashGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const flashMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffffff,
      transparent: true,
      opacity: 1
    });
    
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.set(x, y, z);
    this.scene.add(flash);
    
    // Animate the flash - expand and fade out
    const startTime = performance.now();
    const duration = 300; // ms
    
    const animateFlash = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      flash.scale.set(1 + progress * 2, 1 + progress * 2, 1 + progress * 2);
      flashMaterial.opacity = 1 - progress;
      
      if (progress < 1) {
        requestAnimationFrame(animateFlash);
      } else {
        this.scene.remove(flash);
        flashMaterial.dispose();
        flashGeometry.dispose();
      }
    };
    
    animateFlash();
  }
}

// Initialize the simulation when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Add necessary script tags for Three.js
  const threeScript = document.createElement('script');
  threeScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  document.head.appendChild(threeScript);
  
  // Add OrbitControls
  const orbitControlsScript = document.createElement('script');
  orbitControlsScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/controls/OrbitControls.min.js';
  document.head.appendChild(orbitControlsScript);
  
  // Wait for scripts to load
  orbitControlsScript.onload = () => {
    // Add some basic styling
    const style = document.createElement('style');
    style.textContent = `
      body { margin: 0; overflow: hidden; }
      button { 
        padding: 5px 10px; 
        background: #333; 
        color: white; 
        border: none; 
        border-radius: 3px; 
        cursor: pointer; 
      }
      button:hover { background: #555; }
    `;
    document.head.appendChild(style);
    
    // Start the simulation
    const moshpit = new MoshpitSimulation();
  };
});