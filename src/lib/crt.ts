// The CRT filter's picture: the game drawn again, by the GPU, the way a tube with an aperture grille
// shows it.
//
// A filter laid over the game can only darken it, and part of a tube's look is added light: white
// spilling past its own edges into the glass. So this reads PICO-8's canvas every frame and draws
// the whole picture, in two passes. The first softens each row across, just enough to round off
// the ends of a pixel, into a fixed texture, with red and blue landing a little either side of
// green. The second runs at the screen's own device pixels, and is the only one whose cost grows
// with the screen: it draws each row as scanlines with dark gaps between them, lays the grille's
// RGB stripes over them, adds the glow, read from the first texture's mipmaps, and moves it all
// the way a tube moved.
//
// It keeps the pixels and the scanlines of the overlay it replaced (still in src/styles/_crt.scss,
// as the fallback), and takes only the glass's glow from a softer tube. A phosphor honeycomb was
// tried first and closer to a photo of one, but blurred PICO-8's 1-pixel font and hid the lines.
//
// The motion is a sway, a hum bar rolling up the screen and a flicker, and all of it stays far
// below anything that counts as a flash: the bar dims by 8% and takes seconds to pass, and the
// flicker changes a frame by 3% at most. A still tube (see DrawCrt) has none.

/** PICO-8's screen is this many pixels across, whatever size it's drawn. */
export const GAME_PIXELS = 128;

// Four to a game pixel, so the mipmaps the glow reads are as fine as the picture across and down
// alike, and a power of two, which they need in WebGL 1.
const BEAM_SIZE = 512;

// How far apart scanlines are, in device pixels, at about which a game row gets as many lines as
// fit: two on the handheld on most screens, one where a game pixel is only 3 or 4 device pixels.
// Fine lines are what make the pixels read as small, and a game row is always a whole number of
// them, so no line straddles two rows.
const LINE_PITCH = 4;

const VERTEX = `
attribute vec2 corner;
varying vec2 uv;

void main() {
  uv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const BEAM = `
precision highp float;
varying vec2 uv;
uniform sampler2D game;

// The beam's spot across, in game pixels, as a Gaussian's sigma: it rounds a pixel's ends without
// blurring one into the next. Only the two nearest pixels are near enough to count. Down, nothing
// mixes: the screen pass draws each row as its own scanlines.
const float SPOT = 0.22;

// How far red and blue land either side of green, in game pixels. A tube's three guns never quite
// met, which fringes an edge with colour.
const float CONVERGENCE = 0.12;

// Beams add as light, and what a screen stores is close to the square root of that.
vec3 light(vec2 pixel) {
  vec3 colour = texture2D(game, (pixel + 0.5) / ${GAME_PIXELS}.0).rgb;
  return colour * colour;
}

// The beam at x along a row.
vec3 across(float x, float row) {
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i <= 1; i++) {
    float column = floor(x) + float(i);
    float away = x - column;
    float weight = exp(-away * away / (2.0 * SPOT * SPOT));
    sum += light(vec2(column, row)) * weight;
    total += weight;
  }
  return sum / total;
}

void main() {
  // The canvas's rows run top down and GL's bottom up, so the flip is here, not in the upload.
  vec2 position = vec2(uv.x, 1.0 - uv.y) * ${GAME_PIXELS}.0;
  float row = floor(position.y);
  float x = position.x - 0.5;
  vec3 colour = vec3(across(x + CONVERGENCE, row).r, across(x, row).g, across(x - CONVERGENCE, row).b);
  gl_FragColor = vec4(sqrt(colour), 1.0);
}`;

const SCREEN = `
precision highp float;
varying vec2 uv;
uniform sampler2D beam;
uniform float mipShift;
uniform float lines;    // scanlines to a game row
uniform float time;     // seconds
uniform float motion;   // 1 for a tube that moves, 0 for a still one

// How far a scanline reaches from its centre, in line spacings, for a dark line and a white one: a
// harder-driven beam is wider, so the gaps close up a little in white and stay dark in shadow.
const float LINE_DARK = 0.30;
const float LINE_BRIGHT = 0.37;
const float STRIPE = 0.45;      // what each stripe of the grille lets through of the other two colours
const float DRIVE = 2.0;        // makes up the light the gaps and stripes stop
const float UNLIT = 0.001;      // the faint stripes of a black that's still a lit tube
const float SATURATION = 1.25;
const float EXPOSURE = 1.35;
const float VIGNETTE = 0.25;

const float WOBBLE = 0.1;       // how far the picture sways, in game pixels
const float HUM = 0.08;         // how much the hum bar dims at its darkest
const float HUM_SECONDS = 8.0;  // for the bar to roll the height of the screen
const float FLICKER = 0.03;     // how much a frame can dim

// A row's light at x, read at the row's centre, where the beam pass left it unmixed with the rows
// beside it. Past the top and bottom there are none, so the edge rows stay as thin as the rest.
//
// Always the full-size level, whatever the GPU works out. It picks a mip level from how far the
// coordinates move between neighbouring pixels, and these jump a whole row at each row's edge, so
// left to itself it reads a blurred level there and smears every line sideways. The bias only has
// to be far enough below zero to cover that jump; any lower is clamped to the full-size level.
vec3 rowLight(float row, float x) {
  if (row < 0.0 || row > ${GAME_PIXELS - 1}.0) return vec3(0.0);
  vec3 colour = texture2D(beam, vec2(x, (row + 0.5) / ${GAME_PIXELS}.0), -16.0).rgb;
  return colour * colour;
}

// How much of a line's light reaches this far from its centre. A fourth power, not a Gaussian's
// square, so a line stays flat across most of its height and the gap below it is a clean one.
float scan(float away, vec3 lit) {
  float reach = away / mix(LINE_DARK, LINE_BRIGHT, max(lit.r, max(lit.g, lit.b)));
  reach *= reach;
  return exp(-reach * reach);
}

// The beam's light at a mip level, whatever size the screen is.
vec3 lightAt(float x, float mip) {
  vec3 colour = texture2D(beam, vec2(x, uv.y), mip + mipShift).rgb;
  return colour * colour;
}

void main() {
  // The sway: the sync wandering, as a slow wave down the screen with a faster ripple on it.
  float sway = sin(time * 1.3 + uv.y * 7.0) * 0.7 + sin(time * 5.1 + uv.y * 31.0) * 0.3;
  float x = uv.x + motion * sway * WOBBLE / ${GAME_PIXELS}.0;

  // Each scanline draws the row it falls in.
  float y = uv.y * ${GAME_PIXELS}.0 * lines - 0.5;
  float index = floor(y);
  float down = y - index;
  vec3 near = rowLight(floor((index + 0.5) / lines), x);
  vec3 next = rowLight(floor((index + 1.5) / lines), x);
  vec3 lit = near * scan(down, near) + next * scan(1.0 - down, next);

  // The grille: red, green and blue stripes, a device pixel each, whatever size the game is drawn.
  float column = mod(floor(gl_FragCoord.x), 3.0);
  vec3 stripe = 1.0 - min(abs(vec3(column) - vec3(0.0, 1.0, 2.0)), 1.0);
  vec3 mask = STRIPE + (1.0 - STRIPE) * stripe;
  vec3 colour = lit * mask * DRIVE + UNLIT * mask;

  // Over the scanlines, not under them: this is light scattering in the glass.
  colour += lightAt(x, 2.0) * 0.08 + lightAt(x, 3.0) * 0.06 + lightAt(x, 4.5) * 0.045;

  float grey = dot(colour, vec3(0.3, 0.6, 0.1));
  colour = max(mix(vec3(grey), colour, SATURATION), 0.0);

  // Rolls off instead of clipping, so overdriven colours head for white as they do on glass.
  colour = 1.0 - exp(-colour * EXPOSURE);

  // The hum bar, a soft band about a fifth of the screen high rolling up it, and the flicker, each
  // frame a little dimmer or not. Both only ever dim, so a still tube is the brightest one.
  float hum = pow(0.5 + 0.5 * cos(6.2832 * (uv.y - time / HUM_SECONDS)), 6.0);
  float frame = fract(sin(floor(time * 30.0) * 12.9898) * 43758.5453);
  colour *= 1.0 - motion * (HUM * hum + FLICKER * frame);

  vec2 edge = uv * 2.0 - 1.0;
  colour *= 1.0 - VIGNETTE * pow(dot(edge, edge) * 0.5, 2.0);
  gl_FragColor = vec4(sqrt(colour), 1.0);
}`;

/**
 * Draws the game's current picture, size device pixels square. time is in seconds, for the tube's
 * motion, and null draws a still tube, for prefers-reduced-motion.
 */
export type DrawCrt = (game: HTMLCanvasElement, size: number, time: number | null) => void;

function program(gl: WebGLRenderingContext, fragment: string): WebGLProgram | null {
  const linked = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!linked || !shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(linked, shader);
  }
  if (!linked) return null;
  gl.bindAttribLocation(linked, 0, 'corner');
  gl.linkProgram(linked);
  return gl.getProgramParameter(linked, gl.LINK_STATUS) ? linked : null;
}

function texture(gl: WebGLRenderingContext, min: number, mag: number): WebGLTexture | null {
  const made = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, made);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return made;
}

// Everything the context holds, which a lost context takes with it.
function build(gl: WebGLRenderingContext) {
  const beamPass = program(gl, BEAM);
  const screenPass = program(gl, SCREEN);
  if (!beamPass || !screenPass) return null;

  // One triangle over the whole viewport.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const game = texture(gl, gl.NEAREST, gl.NEAREST);
  const beam = texture(gl, gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BEAM_SIZE, BEAM_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const target = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, target);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, beam, 0);

  return {
    beamPass,
    screenPass,
    game,
    beam,
    target,
    mipShift: gl.getUniformLocation(screenPass, 'mipShift'),
    lines: gl.getUniformLocation(screenPass, 'lines'),
    time: gl.getUniformLocation(screenPass, 'time'),
    motion: gl.getUniformLocation(screenPass, 'motion'),
  };
}

/**
 * Sets up a canvas to draw on, or returns null if this browser can't. Nothing is drawn until the
 * first draw, and a lost context draws nothing until it's back, so the canvas stays transparent
 * and whatever is behind it shows: see .crt-screen, which is the filter for those cases.
 *
 * Nothing to tear down: the context goes with its canvas. Don't lose it on purpose in an effect's
 * cleanup. A canvas has one context for life, so StrictMode's second mount would get the dead one
 * back, and the filter would quietly be the fallback from then on.
 */
export function createCrt(tube: HTMLCanvasElement): DrawCrt | null {
  const gl = tube.getContext('webgl', { antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  let built = build(gl);
  if (!built) return null;

  // Phones take contexts away from pages in the background. Cancelling this asks for it back.
  tube.addEventListener('webglcontextlost', (event) => event.preventDefault());
  tube.addEventListener('webglcontextrestored', () => {
    built = build(gl);
  });

  return (game, size, time) => {
    if (!built) return;
    if (tube.width !== size) {
      tube.width = size;
      tube.height = size;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, built.target);
    gl.viewport(0, 0, BEAM_SIZE, BEAM_SIZE);
    gl.useProgram(built.beamPass);
    gl.bindTexture(gl.TEXTURE_2D, built.game);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, game);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size, size);
    gl.useProgram(built.screenPass);
    gl.bindTexture(gl.TEXTURE_2D, built.beam);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1f(built.mipShift, Math.log2(size / BEAM_SIZE));
    gl.uniform1f(built.lines, Math.max(1, Math.round(size / GAME_PIXELS / LINE_PITCH)));
    gl.uniform1f(built.time, time ?? 0);
    gl.uniform1f(built.motion, time === null ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}
