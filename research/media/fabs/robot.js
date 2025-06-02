<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Semiconductor Robot Control Interface</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f0f0f0;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 20px;
        }
        .visualization {
            text-align: center;
            margin-bottom: 30px;
        }
        canvas {
            border: 1px solid #ccc;
            background-color: #f9f9f9;
        }
        .controls {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            gap: 20px;
        }
        .control-group {
            flex: 1;
            min-width: 200px;
            background-color: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .slider-container {
            margin: 15px 0;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #444;
        }
        input[type="range"] {
            width: 100%;
            margin-bottom: 5px;
        }
        .value-display {
            display: flex;
            justify-content: space-between;
            font-size: 14px;
            color: #666;
        }
        .presets {
            margin-top: 20px;
            text-align: center;
        }
        button {
            background-color: #0066cc;
            color: white;
            border: none;
            padding: 8px 15px;
            margin: 5px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
        }
        button:hover {
            background-color: #0055aa;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Semiconductor Robot Control Interface</h1>
        
        <div class="visualization">
            <canvas id="robotCanvas" width="800" height="400"></canvas>
        </div>
        
        <div class="controls">
            <div class="control-group">
                <h3>Rotation Control</h3>
                <div class="slider-container">
                    <label for="rotation">Rotation (degrees):</label>
                    <input type="range" id="rotation" min="-180" max="180" value="0" step="1">
                    <div class="value-display">
                        <span>-180°</span>
                        <span id="rotationValue">0°</span>
                        <span>180°</span>
                    </div>
                </div>
            </div>
            
            <div class="control-group">
                <h3>Extension Control</h3>
                <div class="slider-container">
                    <label for="extension">Extension (mm):</label>
                    <input type="range" id="extension" min="0" max="400" value="0" step="5">
                    <div class="value-display">
                        <span>0 mm</span>
                        <span id="extensionValue">0 mm</span>
                        <span>400 mm</span>
                    </div>
                </div>
            </div>
            
            <div class="control-group">
                <h3>Z-Axis Control</h3>
                <div class="slider-container">
                    <label for="zAxis">Z-Axis (mm):</label>
                    <input type="range" id="zAxis" min="-200" max="200" value="0" step="5">
                    <div class="value-display">
                        <span>-200 mm</span>
                        <span id="zAxisValue">0 mm</span>
                        <span>200 mm</span>
                    </div>
                </div>
            </div>
            
            <div class="control-group">
                <h3>Track Position</h3>
                <div class="slider-container">
                    <label for="track">Track (mm):</label>
                    <input type="range" id="track" min="-300" max="300" value="0" step="10">
                    <div class="value-display">
                        <span>-300 mm</span>
                        <span id="trackValue">0 mm</span>
                        <span>300 mm</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="presets">
            <h3>Preset Positions</h3>
            <button onclick="moveToPreset('home')">Home Position</button>
            <button onclick="moveToPreset('loadPosition')">Load Position</button>
            <button onclick="moveToPreset('processingPosition')">Processing Position</button>
        </div>
    </div>

    <script>
        // Robot Visualization Controller for Semiconductor Tool Interface
        // This script controls a robot visualization based on user inputs

        // Initialize the robot parameters
        let robotState = {
            rotation: 0,    // degrees
            extension: 0,   // mm
            zAxis: 0,       // mm
            track: 0        // mm
        };

        // DOM elements (to be initialized when document loads)
        let canvas, ctx;
        let rotationInput, extensionInput, zAxisInput, trackInput;

        // Robot dimensions
        const BASE_WIDTH = 80;
        const BASE_HEIGHT = 100;
        const ARM_WIDTH = 160;
        const ARM_HEIGHT = 40;
        const END_EFFECTOR_SIZE = 30;

        // Initialize the application
        document.addEventListener('DOMContentLoaded', function() {
            // Get canvas and context
            canvas = document.getElementById('robotCanvas');
            ctx = canvas.getContext('2d');
            
            // Get input elements
            rotationInput = document.getElementById('rotation');
            extensionInput = document.getElementById('extension');
            zAxisInput = document.getElementById('zAxis');
            trackInput = document.getElementById('track');
            
            // Add event listeners to inputs
            rotationInput.addEventListener('input', updateRobotVisualization);
            extensionInput.addEventListener('input', updateRobotVisualization);
            zAxisInput.addEventListener('input', updateRobotVisualization);
            trackInput.addEventListener('input', updateRobotVisualization);
            
            // Initial drawing
            updateRobotVisualization();
        });

        // Update robot state based on input values
        function updateRobotState() {
            robotState.rotation = parseFloat(rotationInput.value) || 0;
            robotState.extension = parseFloat(extensionInput.value) || 0;
            robotState.zAxis = parseFloat(zAxisInput.value) || 0;
            robotState.track = parseFloat(trackInput.value) || 0;
            
            // Update display values
            document.getElementById('rotationValue').textContent = robotState.rotation.toFixed(1) + '°';
            document.getElementById('extensionValue').textContent = robotState.extension.toFixed(1) + ' mm';
            document.getElementById('zAxisValue').textContent = robotState.zAxis.toFixed(1) + ' mm';
            document.getElementById('trackValue').textContent = robotState.track.toFixed(1) + ' mm';
        }

        // Main function to update the robot visualization
        function updateRobotVisualization() {
            // Update robot state
            updateRobotState();
            
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Set canvas origin to center, adjusted for track
            const centerX = canvas.width / 2 + robotState.track;  
            const centerY = canvas.height / 2;
            
            // Draw track
            drawTrack(centerX, centerY);
            
            // Draw robot base
            drawRobotBase(centerX, centerY);
            
            // Calculate and apply rotation
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(robotState.rotation * Math.PI / 180);
            
            // Draw robot arm with extension
            drawRobotArm(0, 0, robotState.extension);
            
            // Draw end effector with Z-axis adjustment
            drawEndEffector(robotState.extension + ARM_WIDTH/2, 0, robotState.zAxis);
            
            // Restore canvas state
            ctx.restore();
        }

        // Draw the track the robot moves on
        function drawTrack(centerX, centerY) {
            ctx.fillStyle = '#555';
            ctx.fillRect(0, centerY + BASE_HEIGHT/2 - 10, canvas.width, 20);
            
            // Draw track markers
            ctx.fillStyle = '#333';
            for (let x = 50; x < canvas.width; x += 50) {
                ctx.fillRect(x, centerY + BASE_HEIGHT/2 - 15, 5, 30);
            }
        }

        // Draw the robot base
        function drawRobotBase(centerX, centerY) {
            ctx.fillStyle = '#0066cc';
            ctx.fillRect(centerX - BASE_WIDTH/2, centerY - BASE_HEIGHT/2, BASE_WIDTH, BASE_HEIGHT);
            
            // Draw base details
            ctx.fillStyle = '#004d99';
            ctx.fillRect(centerX - BASE_WIDTH/2 + 10, centerY, BASE_WIDTH - 20, BASE_HEIGHT/2 - 10);
        }

        // Draw the extendable robot arm
        function drawRobotArm(x, y, extension) {
            // Calculate arm dimensions with extension
            const armLength = ARM_WIDTH + extension;
            
            // Draw main arm
            ctx.fillStyle = '#cc6600';
            ctx.fillRect(x, y - ARM_HEIGHT/2, armLength, ARM_HEIGHT);
            
            // Draw arm details
            ctx.fillStyle = '#994d00';
            ctx.fillRect(x + 10, y - ARM_HEIGHT/4, armLength - 20, ARM_HEIGHT/2);
        }

        // Draw the end effector with Z-axis adjustment
        function drawEndEffector(x, y, zOffset) {
            // Apply Z-axis offset (visual representation)
            const zVisualOffset = zOffset / 5; // Scale down for visual purposes
            
            // Draw connecting rod
            ctx.fillStyle = '#666';
            ctx.fillRect(x - 5, y - 5, 10, 10 + zVisualOffset);
            
            // Draw end effector
            ctx.fillStyle = '#ff9900';
            ctx.beginPath();
            ctx.arc(x, y + zVisualOffset, END_EFFECTOR_SIZE/2, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw end effector details
            ctx.fillStyle = '#cc7a00';
            ctx.beginPath();
            ctx.arc(x, y + zVisualOffset, END_EFFECTOR_SIZE/4, 0, Math.PI * 2);
            ctx.fill();
        }

        // Export functions for external use
        window.robotController = {
            setRotation: function(value) {
                rotationInput.value = value;
                updateRobotVisualization();
            },
            setExtension: function(value) {
                extensionInput.value = value;
                updateRobotVisualization();
            },
            setZAxis: function(value) {
                zAxisInput.value = value;
                updateRobotVisualization();
            },
            setTrack: function(value) {
                trackInput.value = value;
                updateRobotVisualization();
            },
            getRobotState: function() {
                return {...robotState};
            }
        };

        // Function to animate the robot to specific positions
        function animateRobotTo(targetRotation, targetExtension, targetZ, targetTrack, duration = 1000) {
            const startState = {...robotState};
            const startTime = Date.now();
            
            function animate() {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Linear interpolation between start and target values
                rotationInput.value = startState.rotation + (targetRotation - startState.rotation) * progress;
                extensionInput.value = startState.extension + (targetExtension - startState.extension) * progress;
                zAxisInput.value = startState.zAxis + (targetZ - startState.zAxis) * progress;
                trackInput.value = startState.track + (targetTrack - startState.track) * progress;
                
                updateRobotVisualization();
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                }
            }
            
            animate();
        }

        // Example preset positions (can be expanded)
        const PRESET_POSITIONS = {
            home: { rotation: 0, extension: 0, zAxis: 0, track: 0 },
            loadPosition: { rotation: 90, extension: 200, zAxis: -50, track: 100 },
            processingPosition: { rotation: 180, extension: 300, zAxis: -100, track: -100 }
        };

        // Function to move robot to preset position
        function moveToPreset(presetName) {
            const preset = PRESET_POSITIONS[presetName];
            if (preset) {
                animateRobotTo(preset.rotation, preset.extension, preset.zAxis, preset.track);
            }
        }
    </script>
</body>
</html>