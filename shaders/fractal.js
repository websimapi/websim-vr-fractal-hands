export const vertexShader = `
varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vWorldPosition;

void main() {
    vUv = uv;
    vPosition = position;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const fragmentShader = `
precision highp float;

varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vWorldPosition;

uniform float uTime;
uniform vec3 uCameraPos;
uniform vec3 uHandPos1; // Left index tip
uniform vec3 uHandPos2; // Right index tip
uniform float uHandActive1;
uniform float uHandActive2;
uniform vec2 uResolution;

// Color palette
vec3 palette( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d ) {
    return a + b*cos( 6.28318*(c*t+d) );
}

// Rotation matrix
mat2 rot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
}

// Distance estimator for a fractal (Mandelbox-ish / IFS)
float map(vec3 p) {
    vec3 w = p;
    float m = dot(w,w);
    float scale = 1.5; // Base scale
    
    // Interact with hands: Modulate scale or offset based on hand proximity
    float dH1 = distance(p, uHandPos1);
    float dH2 = distance(p, uHandPos2);
    
    // Influence region: if hand is close, distort space
    float influence = 0.0;
    if(uHandActive1 > 0.5) influence += 1.0 / (1.0 + dH1 * 2.0);
    if(uHandActive2 > 0.5) influence += 1.0 / (1.0 + dH2 * 2.0);
    
    // Dynamic scale modification based on hands
    scale += influence * 0.5;

    float dz = 1.0;
    float n = 0.0;
    
    for(int i = 0; i < 4; i++) {
        // Box fold
        if(abs(w.x) > 1.0) w.x = 2.0 - abs(w.x); // simplistic fold
        if(abs(w.y) > 1.0) w.y = 2.0 - abs(w.y);
        if(abs(w.z) > 1.0) w.z = 2.0 - abs(w.z);

        // Sphere fold
        m = dot(w, w);
        if(m < 0.5) {
            float t = 2.0; 
            w *= t; 
            dz *= t; 
        } else if(m < 1.0) {
            float t = 1.0 / m;
            w *= t;
            dz *= t;
        }

        // Scale and offset
        // Animate offset with time and camera position to create color shifts later
        vec3 offset = vec3(0.5, 0.5, 0.5);
        offset.xy *= rot(uTime * 0.1);
        
        w = scale * w + offset;
        dz = scale * dz + 1.0;
    }
    
    return length(w) / abs(dz);
}

// Raymarching
float raymarch(vec3 ro, vec3 rd) {
    float t = 0.0;
    for(int i = 0; i < 32; i++) { // Low iteration count for VR performance
        vec3 p = ro + rd * t;
        float d = map(p);
        if(d < 0.01 || t > 20.0) break;
        t += d;
    }
    return t;
}

void main() {
    // Basic view direction mapping for skybox-like effect
    vec3 rd = normalize(vWorldPosition - uCameraPos);
    vec3 ro = uCameraPos;

    float t = raymarch(ro, rd);
    
    vec3 col = vec3(0.0);
    
    if(t < 20.0) {
        vec3 p = ro + rd * t;
        
        // Coloring based on position and interaction
        vec3 a = vec3(0.5, 0.5, 0.5);
        vec3 b = vec3(0.5, 0.5, 0.5);
        vec3 c = vec3(1.0, 1.0, 1.0);
        
        // Phase shift d is modified by camera position (user moving around)
        vec3 d = vec3(0.00, 0.33, 0.67) + uCameraPos.x * 0.1 + uCameraPos.y * 0.1;
        
        col = palette(length(p) * 0.2 + uTime * 0.2, a, b, c, d);
        
        // Add glow from hands
        float glow = 0.0;
        if(uHandActive1 > 0.5) glow += 1.0 / (1.0 + distance(p, uHandPos1)*2.0);
        if(uHandActive2 > 0.5) glow += 1.0 / (1.0 + distance(p, uHandPos2)*2.0);
        
        col += vec3(0.0, 1.0, 0.8) * glow;
        
        // Fog
        col = mix(col, vec3(0.0), 1.0 - exp(-0.1 * t));
    } else {
        // Background stars/noise
        float stars = fract(sin(dot(rd.xy, vec2(12.9898,78.233)))*43758.5453);
        if(stars > 0.98) col = vec3(1.0);
    }
    
    gl_FragColor = vec4(col, 1.0);
}
`;

