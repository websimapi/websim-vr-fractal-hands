import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { renderVertexShader, renderFragmentShader, computeShaderPosition, computeShaderVelocity } from './shaders/simulation.js';

let container;
let camera, scene, renderer;
let hand1, hand2;
let controller1, controller2;
let controllerGrip1, controllerGrip2;

let controls;

// Simulation Variables
const WIDTH = 160; // ~25k particles for better performance
let gpuCompute;
let velocityVariable, positionVariable;
let particleUniforms;
let lastTime = 0;

// Hand Tracking Data
const handData = {
    pos1: new THREE.Vector3(100, 100, 100),
    pos2: new THREE.Vector3(100, 100, 100),
    vel1: new THREE.Vector3(),
    vel2: new THREE.Vector3(),
    lastPos1: new THREE.Vector3(100, 100, 100),
    lastPos2: new THREE.Vector3(100, 100, 100),
    active1: 0,
    active2: 0
};

let audioContext;
let audioBuffer;
let soundSource;

init();
animate();

function init() {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    // scene.fog = new THREE.Fog(0x000000, 1, 10);

    // Camera
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);
    camera.position.set(0, 1.6, 2.5);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: false }); // False for performance with particles
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap pixel ratio for performance
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // VR Button
    document.body.appendChild(VRButton.createButton(renderer));

    // Controls for non-VR
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.6, 0);
    controls.update();

    // Init GPU Simulation
    initComputeRenderer();
    
    // Init Visual Particles
    initParticles();

    // Setup Audio
    setupAudio();

    // Controllers & Hands
    setupXR();

    // Resize Listener
    window.addEventListener('resize', onWindowResize);
    
    // Start Overlay
    document.getElementById('start-btn').addEventListener('click', () => {
        document.getElementById('overlay').style.opacity = 0;
        setTimeout(() => {
            document.getElementById('overlay').style.display = 'none';
        }, 1000);
        
        // Init Audio on user gesture
        if(audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
        playAudio();
    });
}

function initComputeRenderer() {
    gpuCompute = new GPUComputationRenderer(WIDTH, WIDTH, renderer);

    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();

    fillTexture(dtPosition, dtVelocity);

    velocityVariable = gpuCompute.addVariable("textureVelocity", computeShaderVelocity, dtVelocity);
    positionVariable = gpuCompute.addVariable("texturePosition", computeShaderPosition, dtPosition);

    gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);
    gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);

    // Uniforms for Velocity Shader
    velocityVariable.material.uniforms["uTime"] = { value: 0.0 };
    velocityVariable.material.uniforms["delta"] = { value: 0.0 };
    velocityVariable.material.uniforms["uHandPos1"] = { value: new THREE.Vector3() };
    velocityVariable.material.uniforms["uHandPos2"] = { value: new THREE.Vector3() };
    velocityVariable.material.uniforms["uHandVel1"] = { value: new THREE.Vector3() };
    velocityVariable.material.uniforms["uHandVel2"] = { value: new THREE.Vector3() };
    velocityVariable.material.uniforms["uHandActive1"] = { value: 0 };
    velocityVariable.material.uniforms["uHandActive2"] = { value: 0 };

    // Uniforms for Position Shader
    positionVariable.material.uniforms["delta"] = { value: 0.0 };

    const error = gpuCompute.init();
    if (error !== null) {
        console.error(error);
    }
}

function fillTexture(texturePosition, textureVelocity) {
    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;

    for (let k = 0, kl = posArray.length; k < kl; k += 4) {
        // Random positions in a sphere
        const r = Math.random() * 1.5;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        
        posArray[k + 0] = r * Math.sin(phi) * Math.cos(theta);
        posArray[k + 1] = r * Math.sin(phi) * Math.sin(theta) + 1.6; // Centered at head height
        posArray[k + 2] = r * Math.cos(phi);
        posArray[k + 3] = 1;

        velArray[k + 0] = 0;
        velArray[k + 1] = 0;
        velArray[k + 2] = 0;
        velArray[k + 3] = 1;
    }
}

function initParticles() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(WIDTH * WIDTH * 3);
    const references = new Float32Array(WIDTH * WIDTH * 2);

    let p = 0;
    for (let i = 0; i < WIDTH * WIDTH; i++) {
        // Position isn't used directly, but Three.js needs bounding box
        positions[p * 3 + 0] = 0;
        positions[p * 3 + 1] = 0;
        positions[p * 3 + 2] = 0;

        const xx = (i % WIDTH) / WIDTH;
        const yy = Math.floor(i / WIDTH) / WIDTH;
        
        references[p * 2 + 0] = xx;
        references[p * 2 + 1] = yy;
        
        p++;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('reference', new THREE.BufferAttribute(references, 2));

    particleUniforms = {
        texturePosition: { value: null },
        textureVelocity: { value: null },
        uTime: { value: 1.0 }
    };

    const material = new THREE.ShaderMaterial({
        uniforms: particleUniforms,
        vertexShader: renderVertexShader,
        fragmentShader: renderFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const particles = new THREE.Points(geometry, material);
    particles.frustumCulled = false; // Important because bounds are static
    scene.add(particles);
}

function setupXR() {
    // Controllers
    controller1 = renderer.xr.getController(0);
    scene.add(controller1);
    controller2 = renderer.xr.getController(1);
    scene.add(controller2);

    const controllerModelFactory = new XRControllerModelFactory();
    const handModelFactory = new XRHandModelFactory();

    // Hand 1
    controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
    scene.add(controllerGrip1);

    hand1 = renderer.xr.getHand(0);
    // Add visual model
    hand1.add(handModelFactory.createHandModel(hand1, 'mesh')); 
    scene.add(hand1);

    // Hand 2
    controllerGrip2 = renderer.xr.getControllerGrip(1);
    controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
    scene.add(controllerGrip2);

    hand2 = renderer.xr.getHand(1);
    hand2.add(handModelFactory.createHandModel(hand2, 'mesh'));
    scene.add(hand2);
}

function setupAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    fetch('drone_ambience.mp3')
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
        .then(decodedAudio => {
            audioBuffer = decodedAudio;
        })
        .catch(e => console.error(e));
}

function playAudio() {
    if (!audioBuffer) return;
    soundSource = audioContext.createBufferSource();
    soundSource.buffer = audioBuffer;
    soundSource.loop = true;
    
    // Gain for volume control
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.5;
    
    soundSource.connect(gainNode);
    gainNode.connect(audioContext.destination);
    soundSource.start(0);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateHandData(delta) {
    // Hand 1
    if (hand1 && hand1.visible && hand1.joints && hand1.joints['index-finger-tip']) {
        const joint = hand1.joints['index-finger-tip'];
        const pos = new THREE.Vector3();
        joint.getWorldPosition(pos);
        
        handData.pos1.copy(pos);
        handData.active1 = 1.0;
    } else if (controller1 && controller1.visible) {
        handData.pos1.copy(controller1.position);
        handData.active1 = 1.0;
    } else {
        handData.active1 = 0.0;
    }

    // Calculate Velocity 1
    if (handData.active1 > 0.5) {
        handData.vel1.subVectors(handData.pos1, handData.lastPos1).divideScalar(delta || 0.016);
        handData.lastPos1.copy(handData.pos1);
    } else {
        handData.vel1.set(0,0,0);
        handData.lastPos1.set(100,100,100);
    }

    // Hand 2
    if (hand2 && hand2.visible && hand2.joints && hand2.joints['index-finger-tip']) {
        const joint = hand2.joints['index-finger-tip'];
        const pos = new THREE.Vector3();
        joint.getWorldPosition(pos);
        
        handData.pos2.copy(pos);
        handData.active2 = 1.0;
    } else if (controller2 && controller2.visible) {
        handData.pos2.copy(controller2.position);
        handData.active2 = 1.0;
    } else {
        handData.active2 = 0.0;
    }

    // Calculate Velocity 2
    if (handData.active2 > 0.5) {
        handData.vel2.subVectors(handData.pos2, handData.lastPos2).divideScalar(delta || 0.016);
        handData.lastPos2.copy(handData.pos2);
    } else {
        handData.vel2.set(0,0,0);
        handData.lastPos2.set(100,100,100);
    }
}

// Mouse interaction for Desktop testing
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

window.addEventListener( 'mousemove', ( event ) => {
	mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
    
    if(!renderer.xr.isPresenting) {
        raycaster.setFromCamera( mouse, camera );
        const pt = raycaster.ray.at(1.5, new THREE.Vector3());
        
        handData.pos1.copy(pt);
        handData.active1 = 1.0;
    }
});

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    const time = performance.now() * 0.001;
    const delta = Math.min(time - lastTime, 0.05); // Cap delta to avoid explosion on lag
    lastTime = time;

    updateHandData(delta);

    // Update GPU Compute Uniforms
    if(velocityVariable && positionVariable) {
        velocityVariable.material.uniforms.uTime.value = time;
        velocityVariable.material.uniforms.delta.value = delta;
        velocityVariable.material.uniforms.uHandPos1.value.copy(handData.pos1);
        velocityVariable.material.uniforms.uHandPos2.value.copy(handData.pos2);
        velocityVariable.material.uniforms.uHandVel1.value.copy(handData.vel1);
        velocityVariable.material.uniforms.uHandVel2.value.copy(handData.vel2);
        velocityVariable.material.uniforms.uHandActive1.value = handData.active1;
        velocityVariable.material.uniforms.uHandActive2.value = handData.active2;
        
        positionVariable.material.uniforms.delta.value = delta;

        // Run Compute
        gpuCompute.compute();

        // Update Render Material with new Textures
        particleUniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
        particleUniforms.textureVelocity.value = gpuCompute.getCurrentRenderTarget(velocityVariable).texture;
        particleUniforms.uTime.value = time;
    }
    
    renderer.render(scene, camera);
}

