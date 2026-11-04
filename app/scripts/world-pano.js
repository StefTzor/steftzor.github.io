/**
 * A 360 street photo in a canvas: an equirectangular JPEG drawn as the inside of a sphere.
 *
 * About a hundred lines of WebGL rather than a viewer library, because a library would be the
 * largest thing on the page and only this is needed: look around, zoom, leave.
 *
 * Dragging follows the pointer 1:1 and carries on from the release speed. Under reduced motion it
 * stops where you let go. Arrow keys and +/- do the same from the keyboard.
 */

const FOV_MIN = 35;
const FOV_MAX = 100;
const FOV_START = 80;
const PITCH_LIMIT = 85;
const KEY_STEP = 6;
const FRICTION = 0.93;
const REST_SPEED = 0.01;

const VERTEX = `#version 300 es
in vec2 corner;
out vec2 screen;
void main() { screen = corner; gl_Position = vec4(corner, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 screen;
out vec4 colour;
uniform sampler2D photo;
uniform float yaw, pitch, reach, aspect;
const float PI = 3.14159265359;
void main() {
  vec3 ray = normalize(vec3(screen.x * reach * aspect, screen.y * reach, -1.0));
  float cp = cos(pitch), sp = sin(pitch), cy = cos(yaw), sy = sin(yaw);
  ray = vec3(ray.x, ray.y * cp + ray.z * sp, -ray.y * sp + ray.z * cp);
  ray = vec3(ray.x * cy - ray.z * sy, ray.y, ray.x * sy + ray.z * cy);
  vec2 uv = vec2(atan(ray.x, -ray.z) / (2.0 * PI) + 0.5, 0.5 - asin(ray.y) / PI);
  colour = texture(photo, uv);
}`;

function shader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ onExit: () => void, still: () => boolean }} o - onExit: zoomed out past the widest view
 * @returns {{ show: (bitmap: ImageBitmap) => void, resize: () => void, stop: () => void }}
 */
export function createPano(canvas, { onExit, still }) {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("webgl2 is unavailable");
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name) => gl.getUniformLocation(program, name);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const view = { yaw: 0, pitch: 0, fov: FOV_START };
  let ready = false;
  let raf = 0;
  let spin = 0;
  let tip = 0;
  let last = null;

  function draw() {
    if (!ready) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(uniform("yaw"), (view.yaw * Math.PI) / 180);
    gl.uniform1f(uniform("pitch"), (view.pitch * Math.PI) / 180);
    gl.uniform1f(uniform("reach"), Math.tan((view.fov * Math.PI) / 360));
    gl.uniform1f(uniform("aspect"), canvas.width / canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const look = (yaw, pitch) => {
    view.yaw += yaw;
    view.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, view.pitch + pitch));
    draw();
  };

  function glide() {
    if (Math.abs(spin) < REST_SPEED && Math.abs(tip) < REST_SPEED) return;
    look(spin, tip);
    spin *= FRICTION;
    tip *= FRICTION;
    raf = requestAnimationFrame(glide);
  }

  const perPixel = () => view.fov / canvas.clientHeight;

  canvas.addEventListener("pointerdown", (e) => {
    cancelAnimationFrame(raf);
    canvas.setPointerCapture(e.pointerId);
    last = { x: e.clientX, y: e.clientY };
    spin = 0;
    tip = 0;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!last) return;
    spin = (last.x - e.clientX) * perPixel();
    tip = (e.clientY - last.y) * perPixel();
    look(spin, tip);
    last = { x: e.clientX, y: e.clientY };
  });
  const release = () => {
    if (!last) return;
    last = null;
    if (!still()) glide();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  function zoom(by) {
    const next = view.fov + by;
    if (next > FOV_MAX) { onExit(); return; }
    view.fov = Math.max(FOV_MIN, next);
    draw();
  }
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoom(e.deltaY * 0.05);
  }, { passive: false });
  canvas.addEventListener("keydown", (e) => {
    const moves = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, KEY_STEP], ArrowDown: [0, -KEY_STEP] };
    if (moves[e.key]) { e.preventDefault(); look(...moves[e.key]); }
    else if (e.key === "+" || e.key === "=") zoom(-KEY_STEP);
    else if (e.key === "-") zoom(KEY_STEP);
  });

  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * scale);
    canvas.height = Math.round(canvas.clientHeight * scale);
    draw();
  }

  return {
    show(bitmap) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      view.yaw = 0;
      view.pitch = 0;
      view.fov = FOV_START;
      ready = true;
      resize();
    },
    resize,
    stop() {
      cancelAnimationFrame(raf);
      last = null;
    },
  };
}
