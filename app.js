import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { vertexShader, fragmentShader } from './shaders/fractal.js';

let container;
let camera, scene, renderer;
let hand1, hand2;
let controller1, controller2;
let controllerGrip1, controllerGrip2;

let controls;

// Shader Uniforms
const uniforms = {
    uTime: { value: 0 },
    uCameraPos: { value: new THREE.Vector3() },
    uHandPos1: { value: new THREE.Vector3(100, 100, 100) }, // Default off-screen
    uHandPos2: { value: new THREE.Vector3(100, 100, 100) },
    uHandActive1: { value: 0 },
    uHandActive2: { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
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

    // Camera
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);
    camera.position.set(0, 1.6, 3);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // VR Button
    document.body.appendChild(VRButton.createButton(renderer));

    // Controls for non-VR
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.6, 0);
    controls.update();

    // Create the "Trippy Room"
    // We use a large inverted box to project the raymarching shader onto
    const geometry = new THREE.BoxGeometry(20, 20, 20);
    // Invert geometry so we see inside
    geometry.scale(-1, 1, 1);
    
    const material = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: uniforms,
        side: THREE.DoubleSide
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 1.6, 0); // Center around typical VR head height
    scene.add(mesh);

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
    uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
}

function updateHandData() {
    // Check if hands are active/visible
    // hand1.visible is true if tracking, but let's check input source
    
    // We try to find the index finger tip
    
    if (hand1 && hand1.visible && hand1.joints && hand1.joints['index-finger-tip']) {
        const joint = hand1.joints['index-finger-tip'];
        // The joint is an Object3D, getWorldPosition gives us the vector
        const pos = new THREE.Vector3();
        joint.getWorldPosition(pos);
        uniforms.uHandPos1.value.copy(pos);
        uniforms.uHandActive1.value = 1.0;
    } else {
        uniforms.uHandActive1.value = 0.0;
        // Fallback to controller position if hand not tracked but controller is
        if(controller1 && controller1.visible) {
             uniforms.uHandPos1.value.copy(controller1.position);
             uniforms.uHandActive1.value = 1.0;
        }
    }

    if (hand2 && hand2.visible && hand2.joints && hand2.joints['index-finger-tip']) {
        const joint = hand2.joints['index-finger-tip'];
        const pos = new THREE.Vector3();
        joint.getWorldPosition(pos);
        uniforms.uHandPos2.value.copy(pos);
        uniforms.uHandActive2.value = 1.0;
    } else {
        uniforms.uHandActive2.value = 0.0;
         if(controller2 && controller2.visible) {
             uniforms.uHandPos2.value.copy(controller2.position);
             uniforms.uHandActive2.value = 1.0;
        }
    }
}

// Mouse interaction for Desktop testing
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

window.addEventListener( 'mousemove', ( event ) => {
	mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
    
    // If not in VR, we can simulate one hand with mouse
    if(!renderer.xr.isPresenting) {
        raycaster.setFromCamera( mouse, camera );
        // Just project out 1.5 units
        const pt = raycaster.ray.at(1.5, new THREE.Vector3());
        uniforms.uHandPos1.value.copy(pt);
        uniforms.uHandActive1.value = 1.0;
    }
});

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    const time = performance.now() * 0.001;
    uniforms.uTime.value = time;
    
    // Update Camera Position Uniform (Head tracking)
    // In VR, the camera position is automatically updated by WebXR
    uniforms.uCameraPos.value.copy(camera.position);

    updateHandData();
    
    renderer.render(scene, camera);
}

