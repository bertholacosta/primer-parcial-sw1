import type { CanonicalDomainModel, AssociationKind } from '../domain/model';

/**
 * Parser determinista del asistente del editor CASE.
 *
 * Convierte instrucciones en español (escritas o dictadas por voz) en comandos
 * del contrato model-commands-v1 ({type, payload}). NUNCA muta el modelo:
 * produce una propuesta que el usuario revisa y aplica explícitamente,
 * coherente con la invariante "solo reglas validadas mutan el modelo".
 */

export interface AssistantCommand {
  type: string;
  payload: Record<string, unknown>;
}

export interface AssistantParseResult {
  /** Comandos propuestos listos para revisar/despachar. Vacío si hay aclaración. */
  commands: AssistantCommand[];
  /** Resumen legible de lo que haría la propuesta. */
  summary: string;
  /** Presente cuando no se pudo producir una propuesta aplicable. */
  clarification?: string;
}

const ATTRIBUTE_TYPES = ['String', 'Integer', 'Long', 'Double', 'Boolean', 'Date', 'DateTime', 'UUID'] as const;

/** Alias normalizados (minúsculas, sin tildes) → tipo canónico. */
const TYPE_ALIASES: Record<string, string> = {
  string: 'String', texto: 'String', cadena: 'String', char: 'String',
  int: 'Integer', integer: 'Integer', entero: 'Integer', numero: 'Integer', short: 'Integer', byte: 'Integer',
  long: 'Long', biginteger: 'Long',
  double: 'Double', doble: 'Double', decimal: 'Double', real: 'Double', float: 'Double', bigdecimal: 'Double',
  boolean: 'Boolean', booleano: 'Boolean', bool: 'Boolean',
  date: 'Date', fecha: 'Date',
  datetime: 'DateTime', fechahora: 'DateTime', timestamp: 'DateTime',
  uuid: 'UUID',
};

const RELATION_KINDS: Record<string, AssociationKind> = {
  asociacion: 'association',
  relacion: 'association',
  agregacion: 'aggregation',
  composicion: 'composition',
  generalizacion: 'generalization',
  herencia: 'generalization',
  dependencia: 'dependency',
};

/** Minúsculas sin tildes para comparaciones. */
const norm = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Convierte texto libre a identificador válido UpperCamelCase (clases). */
function toUpperCamel(raw: string): string {
  const words = norm(raw).split(/[^a-z0-9]+/).filter(Boolean);
  const joined = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (!joined) return '';
  return /^[0-9]/.test(joined) ? `C_${joined}` : joined;
}

/** Convierte texto libre a identificador válido lowerCamelCase (atributos). */
function toLowerCamel(raw: string): string {
  const upper = toUpperCamel(raw);
  if (!upper) return '';
  const core = upper.startsWith('C_') ? 'c_' + upper.slice(2) : upper[0].toLowerCase() + upper.slice(1);
  return IDENTIFIER_PATTERN.test(core) ? core : `a_${core.replace(/^[^A-Za-z_]+/, '')}`;
}

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** Busca una clase por nombre tolerando mayúsculas y tildes. */
function findClass(model: CanonicalDomainModel, rawName: string) {
  const target = norm(toUpperCamel(rawName)) || norm(rawName);
  return model.classes.find((c) => norm(c.name) === target)
    ?? model.classes.find((c) => norm(c.name) === norm(rawName));
}

const classList = (model: CanonicalDomainModel) =>
  model.classes.map((c) => c.name).join(', ') || '(ninguna aún)';

const noClass = (model: CanonicalDomainModel, raw: string): AssistantParseResult => ({
  commands: [],
  summary: '',
  clarification: `No encuentro la clase '${toUpperCamel(raw) || raw.trim()}'. Clases disponibles: ${classList(model)}.`,
});

interface AttrSpec {
  name: string;
  type: string;
  nullable: boolean;
  multiplicity: string;
}

/** Parsea un item de spec de atributo: "nombre", "edad Integer", "email: String opcional". */
function parseAttrSpec(item: string): AttrSpec | null {
  const tokens = item.replace(/[:;,]/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const name = toLowerCamel(tokens[0]);
  if (!name) return null;
  let type = 'String';
  let optional = false;
  let unknownType: string | null = null;
  for (const token of tokens.slice(1)) {
    const t = norm(token);
    if (t === 'de' || t === 'tipo' || t === 'del' || t === 'la' || t === 'el') continue;
    if (t === 'opcional' || t === 'nulo' || t === 'nullable') { optional = true; continue; }
    if (t === 'obligatorio' || t === 'requerido' || t === 'notnull') { optional = false; continue; }
    const mapped = TYPE_ALIASES[t];
    if (mapped) type = mapped;
    else unknownType = token;
  }
  if (unknownType) return { name, type: `?${unknownType}`, nullable: optional, multiplicity: optional ? '0..1' : '1' };
  return { name, type, nullable: optional, multiplicity: optional ? '0..1' : '1' };
}

/** Divide una lista de specs de atributos ("a String, b Integer y c Date"). */
function splitAttrList(spec: string): string[] {
  return spec
    .split(/,|\sy\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function addAttrCommand(classId: string, spec: AttrSpec): AssistantCommand {
  return {
    type: 'AddAttribute',
    payload: {
      id: newId('attr'),
      classId,
      name: spec.name,
      type: spec.type,
      nullable: spec.nullable,
      multiplicity: spec.multiplicity,
    },
  };
}

const HELP_TEXT =
  'Puedo entender: "crea clase Cliente", "crea clase Cliente con nombre String, edad Integer", ' +
  '"añade atributo email String a Cliente", "elimina atributo email de Cliente", ' +
  '"renombra Cliente a Persona", "elimina clase Cliente", ' +
  '"crea asociación entre Cliente y Venta" (también agregación, composición, generalización/herencia, dependencia), ' +
  '"elimina relación entre Cliente y Venta", "cambia tipo de edad en Cliente a Long", ' +
  '"haz email de Cliente opcional/obligatorio" y "ayuda".';

export function parseAssistantMessage(
  text: string,
  model: CanonicalDomainModel,
): AssistantParseResult {
  const raw = text.trim().replace(/\s+/g, ' ');
  if (!raw) {
    return { commands: [], summary: '', clarification: 'Escribe o dicta una instrucción. Escribe "ayuda" para ver ejemplos.' };
  }
  const t = norm(raw);

  // --- ayuda ---
  if (/^(ayuda|help|que puedes hacer|comandos|opciones)\b/.test(t)) {
    return { commands: [], summary: '', clarification: HELP_TEXT };
  }

  // --- crear clase [con atributos] ---
  const createClass = t.match(
    /^(?:crea|crear|añade|anade|agrega|nueva|nuevo)(?:\s+un[ao]?|\s+la|\s+el)?\s+clase\s+(?:llamad[ao]\s+)?(.+?)(?:\s+con\s+(?:(?:los|las|sus)\s+)?(?:atributos?\s*[:\-]?\s*)?(.+))?$/
  );
  if (createClass) {
    const className = toUpperCamel(createClass[1]);
    if (!className) {
      return { commands: [], summary: '', clarification: 'No pude derivar un nombre de clase válido. Usa letras, por ejemplo "crea clase Cliente".' };
    }
    if (findClass(model, className)) {
      return { commands: [], summary: '', clarification: `Ya existe la clase '${className}'. Para modificarla: "añade atributo X a ${className}" o "elimina clase ${className}".` };
    }
    const classId = newId('cls');
    const commands: AssistantCommand[] = [
      { type: 'CreateClass', payload: { id: classId, name: className } },
    ];
    const attrSpecs: AttrSpec[] = [];
    const badTypes: string[] = [];
    if (createClass[2]) {
      for (const item of splitAttrList(createClass[2])) {
        const spec = parseAttrSpec(item);
        if (spec) {
          if (spec.type.startsWith('?')) {
            badTypes.push(spec.type.slice(1));
            spec.type = 'String';
          }
          attrSpecs.push(spec);
          commands.push(addAttrCommand(classId, spec));
        }
      }
    }
    let summary = `Crear la clase '${className}'` +
      (attrSpecs.length ? ` con ${attrSpecs.length} atributo(s): ${attrSpecs.map((a) => `${a.name}: ${a.type}`).join(', ')}` : ' (sin atributos)');
    if (badTypes.length) {
      summary += `. Tipos no reconocidos (${badTypes.join(', ')}) se asignaron como String — revísalos`;
    }
    return { commands, summary };
  }

  // --- añadir atributo: "añade (el) atributo email String a Cliente" ---
  const addAttr = t.match(
    /^(?:añade|anade|agrega|añadir|anadir|agregar|pon)(?:\s+(?:el|un|le|a\s+la\s+clase|a))?\s*atributo\s+(.+?)\s+a\s+(?:la\s+clase\s+)?(.+)$/
  ) ?? t.match(
    /^(?:añade|anade|agrega|añadir|anadir|agregar|pon)\s+a\s+(?:la\s+clase\s+)?(.+?)\s+(?:el\s+)?atributo\s+(.+)$/
  );
  if (addAttr) {
    // Dos formas: "...atributo X a Clase" (grupos [attr,class]) o "...a Clase el atributo X" ([class,attr]).
    const swapped = /^(\S+)\s+(?:a|al)\s+/.test(addAttr[1]) ? false : !/\s/.test(addAttr[1].trim()) && findClass(model, addAttr[1]) !== undefined;
    const attrRaw = swapped ? addAttr[2] : addAttr[1];
    const classRaw = swapped ? addAttr[1] : addAttr[2];
    const cls = findClass(model, classRaw);
    if (!cls) return noClass(model, classRaw);
    const spec = parseAttrSpec(attrRaw);
    if (!spec) {
      return { commands: [], summary: '', clarification: `No entendí el atributo en '${attrRaw}'. Ejemplo: "añade atributo email String a ${cls.name}".` };
    }
    if (spec.type.startsWith('?')) {
      return { commands: [], summary: '', clarification: `Tipo '${toUpperCamel(spec.type.slice(1))}' no reconocido. Tipos: ${ATTRIBUTE_TYPES.join(', ')}.` };
    }
    if (cls.attributes.some((a) => norm(a.name) === norm(spec.name))) {
      return { commands: [], summary: '', clarification: `La clase '${cls.name}' ya tiene el atributo '${spec.name}'.` };
    }
    return {
      commands: [addAttrCommand(cls.id, spec)],
      summary: `Añadir '${spec.name}: ${spec.type} [${spec.multiplicity}]' a '${cls.name}'`,
    };
  }

  // --- eliminar atributo ---
  const delAttr = t.match(
    /^(?:elimina|borra|quita|eliminar|borrar|quitar)(?:\s+el|\s+la)?\s+atributo\s+(\S+)\s+(?:de|en)\s+(?:la\s+clase\s+)?(.+)$/
  );
  if (delAttr) {
    const cls = findClass(model, delAttr[2]);
    if (!cls) return noClass(model, delAttr[2]);
    const attr = cls.attributes.find((a) => norm(a.name) === norm(delAttr[1]));
    if (!attr) {
      return { commands: [], summary: '', clarification: `La clase '${cls.name}' no tiene el atributo '${delAttr[1]}'. Atributos: ${cls.attributes.map((a) => a.name).join(', ') || '(ninguno)'}.` };
    }
    return {
      commands: [{ type: 'DeleteAttribute', payload: { classId: cls.id, attributeId: attr.id } }],
      summary: `Eliminar el atributo '${attr.name}' de '${cls.name}'`,
    };
  }

  // --- cambiar tipo de atributo ---
  const chType = t.match(
    /^(?:cambia|modifica|pon)(?:\s+el)?\s+tipo\s+de\s+(\S+)\s+(?:en|de)\s+(?:la\s+clase\s+)?(.+?)\s+a\s+(\S+)$/
  );
  if (chType) {
    const cls = findClass(model, chType[2]);
    if (!cls) return noClass(model, chType[2]);
    const attr = cls.attributes.find((a) => norm(a.name) === norm(chType[1]));
    if (!attr) {
      return { commands: [], summary: '', clarification: `La clase '${cls.name}' no tiene el atributo '${chType[1]}'.` };
    }
    const type = TYPE_ALIASES[norm(chType[3])];
    if (!type) {
      return { commands: [], summary: '', clarification: `Tipo '${toUpperCamel(chType[3])}' no reconocido. Tipos: ${ATTRIBUTE_TYPES.join(', ')}.` };
    }
    return {
      commands: [{ type: 'UpdateAttribute', payload: { attributeId: attr.id, classId: cls.id, type } }],
      summary: `Cambiar '${cls.name}.${attr.name}' a tipo ${type}`,
    };
  }

  // --- atributo opcional/obligatorio ---
  const optAttr = t.match(
    /^(?:haz|marca|pon)(?:\s+el\s+atributo|\s+el|\s+la)?\s+(\S+)\s+de\s+(?:la\s+clase\s+)?(.+?)\s+(opcional|obligatorio|requerido)$/
  );
  if (optAttr) {
    const cls = findClass(model, optAttr[2]);
    if (!cls) return noClass(model, optAttr[2]);
    const attr = cls.attributes.find((a) => norm(a.name) === norm(optAttr[1]));
    if (!attr) {
      return { commands: [], summary: '', clarification: `La clase '${cls.name}' no tiene el atributo '${optAttr[1]}'.` };
    }
    const optional = optAttr[3] === 'opcional';
    return {
      commands: [{
        type: 'UpdateAttribute',
        payload: { attributeId: attr.id, classId: cls.id, multiplicity: optional ? '0..1' : '1', nullable: optional },
      }],
      summary: `Marcar '${cls.name}.${attr.name}' como ${optAttr[3]} (${optional ? '0..1, nullable' : '1, no nulo'})`,
    };
  }

  // --- renombrar clase ---
  const rename = t.match(
    /^(?:renombra|renombrar|cambia(?:r)?\s+el\s+nombre\s+de|cambia(?:r)?)(?:\s+la\s+clase)?\s+(\S+)\s+a\s+(.+)$/
  );
  if (rename) {
    const cls = findClass(model, rename[1]);
    if (!cls) return noClass(model, rename[1]);
    const newName = toUpperCamel(rename[2]);
    if (!newName) {
      return { commands: [], summary: '', clarification: 'El nuevo nombre no es un identificador válido.' };
    }
    if (findClass(model, newName)) {
      return { commands: [], summary: '', clarification: `Ya existe una clase llamada '${newName}'.` };
    }
    return {
      commands: [{ type: 'RenameClass', payload: { classId: cls.id, newName } }],
      summary: `Renombrar '${cls.name}' a '${newName}'`,
    };
  }

  // --- eliminar clase ---
  const delClass = t.match(
    /^(?:elimina|borra|quita|eliminar|borrar|quitar)(?:\s+la|\s+el)?\s+clase\s+(.+)$/
  );
  if (delClass) {
    const cls = findClass(model, delClass[1]);
    if (!cls) return noClass(model, delClass[1]);
    const affected = model.associations.filter(
      (a) => a.sourceClassId === cls.id || a.targetClassId === cls.id
    ).length;
    return {
      commands: [{ type: 'DeleteClass', payload: { classId: cls.id } }],
      summary: `Eliminar la clase '${cls.name}'` +
        (affected ? ` (y sus ${affected} relación(es) en cascada)` : ''),
    };
  }

  // --- crear relación ---
  const createRel = t.match(
    /^(?:crea|crear|conecta|relaciona|añade|anade|agrega|vincula|une)(?:\s+un[ao]?|\s+la|\s+el)?\s+(asociacion|relacion|agregacion|composicion|generalizacion|herencia|dependencia)\s+entre\s+(\S+)\s+y\s+(\S+)$/
  );
  if (createRel) {
    const kind = RELATION_KINDS[createRel[1]] ?? 'association';
    const source = findClass(model, createRel[2]);
    if (!source) return noClass(model, createRel[2]);
    const target = findClass(model, createRel[3]);
    if (!target) return noClass(model, createRel[3]);
    if (source.id === target.id) {
      return { commands: [], summary: '', clarification: 'Las auto-asociaciones no están permitidas (misma clase origen y destino).' };
    }
    const structural = kind !== 'generalization' && kind !== 'dependency';
    const commands: AssistantCommand[] = [{
      type: 'CreateAssociation',
      payload: {
        id: newId('assoc'),
        sourceClassId: source.id,
        targetClassId: target.id,
        sourceMultiplicity: structural ? '1' : '1',
        targetMultiplicity: structural ? '0..*' : '1',
        navigability: structural ? 'bidirectional' : 'unidirectional',
        kind,
      },
    }];
    return {
      commands,
      summary: `Crear ${createRel[1]} ${source.name} → ${target.name}` +
        (structural ? ' [1 → 0..*]' : ''),
    };
  }

  // --- eliminar relación ---
  const delRel = t.match(
    /^(?:elimina|borra|quita|eliminar|borrar|quitar)(?:\s+la|\s+el)?\s+(?:asociacion|relacion|agregacion|composicion|generalizacion|herencia|dependencia|vinculo)\s+entre\s+(\S+)\s+y\s+(\S+)$/
  );
  if (delRel) {
    const a = findClass(model, delRel[1]);
    if (!a) return noClass(model, delRel[1]);
    const b = findClass(model, delRel[2]);
    if (!b) return noClass(model, delRel[2]);
    const assoc = model.associations.find(
      (x) =>
        (x.sourceClassId === a.id && x.targetClassId === b.id) ||
        (x.sourceClassId === b.id && x.targetClassId === a.id)
    );
    if (!assoc) {
      return { commands: [], summary: '', clarification: `No hay ninguna relación entre '${a.name}' y '${b.name}'.` };
    }
    const sName = model.classes.find((c) => c.id === assoc.sourceClassId)?.name ?? assoc.sourceClassId;
    const tName = model.classes.find((c) => c.id === assoc.targetClassId)?.name ?? assoc.targetClassId;
    return {
      commands: [{ type: 'DeleteAssociation', payload: { associationId: assoc.id } }],
      summary: `Eliminar la relación ${sName} → ${tName}`,
    };
  }

  return {
    commands: [],
    summary: '',
    clarification: `No entendí la instrucción. ${HELP_TEXT}`,
  };
}

/** Etiqueta legible por comando (para la burbuja de propuesta del chat). */
export function describeAssistantCommand(
  cmd: AssistantCommand,
  model: CanonicalDomainModel,
  pendingClasses: Map<string, string>,
): string {
  const p = cmd.payload;
  const ref = (id: unknown) =>
    pendingClasses.get(String(id)) ??
    model.classes.find((c) => c.id === id)?.name ??
    String(id ?? '?');
  switch (cmd.type) {
    case 'CreateClass': return `Clase '${p.name}'`;
    case 'RenameClass': return `'${ref(p.classId)}' → '${p.newName}'`;
    case 'DeleteClass': return `Eliminar '${ref(p.classId)}'`;
    case 'AddAttribute': return `Atributo '${p.name}: ${p.type}' en ${ref(p.classId)}`;
    case 'UpdateAttribute': return `Actualizar atributo en ${ref(p.classId)}`;
    case 'DeleteAttribute': return `Eliminar atributo en ${ref(p.classId)}`;
    case 'CreateAssociation': return `Relación ${p.kind ?? 'association'}: ${ref(p.sourceClassId)} → ${ref(p.targetClassId)}`;
    case 'UpdateAssociation': return `Actualizar relación ${ref(p.associationId)}`;
    case 'DeleteAssociation': return `Eliminar relación`;
    default: return cmd.type;
  }
}
