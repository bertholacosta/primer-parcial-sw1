export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export class XmlParseError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(message);
    this.name = 'XmlParseError';
  }
}

export function parseXml(xmlContent: string): XmlNode {
  // Strip UTF-8 BOM if present
  let xml = xmlContent;
  if (xml.charCodeAt(0) === 0xfeff) {
    xml = xml.slice(1);
  }

  let index = 0;
  const length = xml.length;

  function skipWhitespace() {
    while (index < length && /\s/.test(xml[index])) {
      index++;
    }
  }

  function parseAttributes(): Record<string, string> {
    const attributes: Record<string, string> = {};
    while (index < length) {
      skipWhitespace();
      if (index >= length || xml[index] === '>' || xml[index] === '/' || xml[index] === '?') {
        break;
      }

      const attrNameStart = index;
      while (index < length && !/[\s=>/?]/.test(xml[index])) {
        index++;
      }
      const attrName = xml.slice(attrNameStart, index);
      if (!attrName) {
        throw new XmlParseError('Expected attribute name');
      }

      skipWhitespace();
      if (index >= length || xml[index] !== '=') {
        throw new XmlParseError(`Attribute '${attrName}' is missing '=' separator`);
      }
      index++; // skip '='
      skipWhitespace();

      if (index >= length || (xml[index] !== '"' && xml[index] !== "'")) {
        throw new XmlParseError(`Attribute '${attrName}' value must be enclosed in quotes`);
      }

      const quote = xml[index];
      index++;
      const valStart = index;
      while (index < length && xml[index] !== quote) {
        index++;
      }
      if (index >= length) {
        throw new XmlParseError(`Unterminated quote for attribute '${attrName}'`);
      }
      const val = xml.slice(valStart, index);
      index++; // skip closing quote

      attributes[attrName] = decodeXmlEntities(val);
    }
    return attributes;
  }

  function decodeXmlEntities(text: string): string {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let rootClosed = false;

  while (index < length) {
    skipWhitespace();
    if (index >= length) break;

    if (xml[index] === '<') {
      if (xml.startsWith('<?', index)) {
        // XML declaration or processing instruction
        const end = xml.indexOf('?>', index);
        if (end === -1) throw new XmlParseError('Unclosed processing instruction');
        index = end + 2;
        continue;
      }
      if (xml.startsWith('<!--', index)) {
        // Comment
        const end = xml.indexOf('-->', index);
        if (end === -1) throw new XmlParseError('Unclosed XML comment');
        index = end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', index)) {
        if (rootClosed) {
          throw new XmlParseError('Content found after root element');
        }
        const end = xml.indexOf(']]>', index);
        if (end === -1) throw new XmlParseError('Unclosed CDATA');
        const cdataText = xml.slice(index + 9, end);
        if (stack.length > 0) {
          stack[stack.length - 1].text += cdataText;
        }
        index = end + 3;
        continue;
      }
      if (xml.startsWith('</', index)) {
        // Closing tag
        index += 2;
        skipWhitespace();
        const tagStart = index;
        while (index < length && !/[\s>]/.test(xml[index])) {
          index++;
        }
        const closingTag = xml.slice(tagStart, index);
        skipWhitespace();
        if (index >= length || xml[index] !== '>') {
          throw new XmlParseError(`Malformed closing tag: </${closingTag}>`);
        }
        index++;

        if (stack.length === 0) {
          throw new XmlParseError(`Unexpected closing tag: </${closingTag}>`);
        }
        const current = stack.pop()!;
        if (current.name !== closingTag) {
          throw new XmlParseError(`Mismatched closing tag: expected </${current.name}>, got </${closingTag}>`);
        }
        if (stack.length === 0) {
          rootClosed = true;
        }
        continue;
      }

      // Opening or self-closing tag
      if (rootClosed) {
        throw new XmlParseError('Multiple root elements detected; only one root element is permitted');
      }

      index++; // skip '<'
      skipWhitespace();
      const tagStart = index;
      while (index < length && !/[\s/>]/.test(xml[index])) {
        index++;
      }
      const tagName = xml.slice(tagStart, index);
      if (!tagName) {
        throw new XmlParseError('Expected tag name');
      }

      const attributes = parseAttributes();
      skipWhitespace();

      let selfClosing = false;
      if (index < length && xml[index] === '/') {
        selfClosing = true;
        index++;
        skipWhitespace();
      }

      if (index >= length || xml[index] !== '>') {
        throw new XmlParseError(`Unclosed tag <${tagName}>`);
      }
      index++; // skip '>'

      const node: XmlNode = {
        name: tagName,
        attributes,
        children: [],
        text: ''
      };

      if (!root) {
        root = node;
      }

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      }

      if (!selfClosing) {
        stack.push(node);
      } else if (stack.length === 0) {
        rootClosed = true;
      }
    } else {
      // Text content outside tags
      if (rootClosed) {
        const textStart = index;
        while (index < length) {
          if (!/\s/.test(xml[index])) {
            throw new XmlParseError('Non-whitespace character found after root element');
          }
          index++;
        }
        break;
      }
      const textStart = index;
      while (index < length && xml[index] !== '<') {
        index++;
      }
      const rawText = xml.slice(textStart, index);
      if (stack.length > 0) {
        stack[stack.length - 1].text += decodeXmlEntities(rawText);
      }
    }
  }

  if (stack.length > 0) {
    throw new XmlParseError(`Unclosed tags remaining: ${stack.map(n => n.name).join(', ')}`);
  }

  if (!root) {
    throw new XmlParseError('Empty XML document');
  }

  return root;
}
