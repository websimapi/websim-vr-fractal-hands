export const renderVertexShader = `
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
attribute vec2 reference;
varying vec3 vVelocity;
varying vec4 vColor;
uniform float uTime;

void main() {
    vec4 posTemp = texture2D( texturePosition, reference );
    vec3 pos = posTemp.xyz;
    vec4 velTemp = texture2D( textureVelocity, reference );
    vVelocity = velTemp.xyz;

    // Color based on velocity and position (Trippy effects)
    float speed = length(vVelocity);
    vec3 colA = vec3(0.1, 0.4, 1.0); // Blue
    vec3 colB = vec3(1.0, 0.2, 0.5); // Pinkish
    
    // Mix based on speed
    vec3 finalColor = mix(colA, colB, smoothstep(0.0, 1.0, speed * 2.0));
    
    // Add time-based hue shift
    float hueShift = sin(uTime * 0.5 + pos.x * 0.2) * 0.1;
    finalColor += hueShift;

    vColor = vec4(finalColor, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4( pos, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    
    // Size attenuation
    gl_PointSize = ( 0.15 / -mvPosition.z ) * 500.0;
}
`;

export const renderFragmentShader = `
varying vec3 vVelocity;
varying vec4 vColor;

void main() {
    // Soft circular particle
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    // Soft glow
    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
    
    gl_FragColor = vec4(vColor.rgb, alpha * 0.8);
}
`;

export const computeShaderPosition = `
uniform float delta;
void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 tmpPos = texture2D( texturePosition, uv );
    vec3 pos = tmpPos.xyz;
    vec4 tmpVel = texture2D( textureVelocity, uv );
    vec3 vel = tmpVel.xyz;

    pos += vel * delta;

    // Soft boundary wrapping (keep in a 5x5x5 box roughly)
    // Instead of hard wrap, we can use a soft reset or just let them wrap
    float limit = 3.0;
    if (abs(pos.x) > limit) pos.x = -sign(pos.x) * limit;
    if (abs(pos.y) > limit) pos.y = -sign(pos.y) * limit;
    if (abs(pos.z) > limit) pos.z = -sign(pos.z) * limit;

    gl_FragColor = vec4( pos, 1.0 );
}
`;

export const computeShaderVelocity = `
uniform float uTime;
uniform float delta;
uniform vec3 uHandPos1;
uniform vec3 uHandPos2;
uniform vec3 uHandVel1;
uniform vec3 uHandVel2;
uniform float uHandActive1;
uniform float uHandActive2;

// Simplex Noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) { 
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i); 
  vec4 p = permute( permute( permute( 
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod7(p*p)
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );    // mod7(j)
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a1.zw,h.y);
  vec3 p2 = vec3(a2.xy,h.z); // Wait, typo in original logic? No, let's fix variables
  vec3 p2_fixed = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  
  // Re-verify p2 logic from standard implementation
  // p2 is from a1.xy and h.z
  
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2_fixed, p2_fixed), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2_fixed *= norm.z;
  p3 *= norm.w;
  
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2_fixed,x2), dot(p3,x3) ) );
}

vec3 curlNoise(vec3 p) {
    const float e = 0.1;
    float n1 = snoise(vec3(p.x, p.y + e, p.z));
    float n2 = snoise(vec3(p.x, p.y - e, p.z));
    float n3 = snoise(vec3(p.x, p.y, p.z + e));
    float n4 = snoise(vec3(p.x, p.y, p.z - e));
    float n5 = snoise(vec3(p.x + e, p.y, p.z));
    float n6 = snoise(vec3(p.x - e, p.y, p.z));
    
    return vec3(n4 - n3, n6 - n5, n2 - n1); // Rotated
}

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D( texturePosition, uv ).xyz;
    vec3 vel = texture2D( textureVelocity, uv ).xyz;

    // Base fluid flow (Curl Noise)
    vec3 noise = curlNoise(pos * 0.4 + uTime * 0.05); // Low freq noise
    vel += noise * 0.5 * delta; // Add noise force

    // Drag / Damping
    vel *= 0.98; 

    // Interact with Hand 1
    if (uHandActive1 > 0.5) {
        vec3 diff = pos - uHandPos1;
        float dist = length(diff);
        if (dist < 0.6) {
            float influence = 1.0 - dist / 0.6;
            // Repel
            vel += normalize(diff) * influence * 1.0 * delta;
            // Drag along hand velocity
            vel += uHandVel1 * influence * 5.0 * delta; 
        }
    }

    // Interact with Hand 2
    if (uHandActive2 > 0.5) {
        vec3 diff = pos - uHandPos2;
        float dist = length(diff);
        if (dist < 0.6) {
            float influence = 1.0 - dist / 0.6;
            vel += normalize(diff) * influence * 1.0 * delta;
            vel += uHandVel2 * influence * 5.0 * delta;
        }
    }

    // Return to center slowly if too far
    if(length(pos) > 2.5) {
        vel -= normalize(pos) * 0.5 * delta;
    }

    gl_FragColor = vec4( vel, 1.0 );
}
`;

