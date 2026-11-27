import taskSchema from '../schemas/task.v1.json' with { type: 'json' };
import perceptionSchema from '../schemas/perception.v1.json' with { type: 'json' };
import resultSchema from '../schemas/result.v1.json' with { type: 'json' };

export { perceptionSchema };
export const sides = ['Left', 'Right'];
export const other = (side) => (side === 'Left' ? 'Right' : 'Left');
export const pair = (fn) => Object.fromEntries(sides.map((side) => [side, fn(side)]));
export function createTask() {
  return {
    version: '1.0',
    id: crypto.randomUUID(),
    request: '',
    images: pair(() => null),
    source: 'file',
    provenance: 'Manual input',
    warnings: [],
    rubricVersion: '1.1',
    captureScope: 'unknown',
  };
}
export function assign(task, side, image) {
  if (!sides.includes(side)) throw Error('Unknown candidate side.');
  if (image && task.images[other(side)]?.id === image.id) {
    task.images[other(side)] = task.images[side];
  }
  task.images[side] = image;
}
export const swap = (task) => ({ ...task, images: pair((side) => task.images[other(side)]) });

// Implements exactly the JSON Schema keywords used in the versioned contracts.
function check(value, schema, path) {
  const fail = () => {
    throw Error('Invalid ' + path);
  };
  if (schema.$ref === 'perception.v1.json') return check(value, perceptionSchema, path);
  if ('const' in schema && value !== schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (
    schema.type &&
    ![schema.type].flat().some((t) => t === type || (t === 'integer' && Number.isInteger(value)))
  )
    fail();
  if (typeof value === 'number' && (!Number.isFinite(value) || value < schema.minimum)) fail();
  if (schema.minLength && (typeof value !== 'string' || !value.trim())) fail();
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail();
  if (schema.items) value.forEach((v, i) => check(v, schema.items, path + '[' + i + ']'));
  if (schema.properties) {
    for (const k of schema.required) if (!Object.hasOwn(value, k)) throw Error('Missing ' + path + '.' + k);
    for (const [k, v] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, k)) throw Error('Unexpected field in ' + path);
      check(v, schema.properties[k], path + '.' + k);
    }
  }
  return value;
}
export function validateTask(task) {
  check(task, taskSchema, 'task');
  if (task.images.Left.id === task.images.Right.id) throw Error('Assign distinct candidate references.');
  return task;
}
export function validateObservation(o, task) {
  check(o, perceptionSchema, 'observation');
  const seen = new Set();
  for (const r of o.requirements) {
    if (!task.request.includes(r.excerpt) || seen.has(r.excerpt))
      throw Error('Unmatched or repeated request excerpt.');
    seen.add(r.excerpt);
    for (const side of sides) {
      if (
        (r.scope === 'visible' && r.status[side] === 'excluded') ||
        (['later', 'unobservable'].includes(r.scope) && r.status[side] !== 'excluded')
      )
        throw Error('Inconsistent requirement applicability.');
    }
    if (['functionality', 'later_state'].includes(r.kind) && r.scope === 'visible')
      throw Error('Hidden behavior cannot decide adherence.');
  }
  return o;
}
export const validateShape = (result) => check(result, resultSchema, 'result');
