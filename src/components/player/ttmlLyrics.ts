export type TtmlLyricWord = {
  text: string
  startTime: number
  endTime: number
}

export type TtmlLyricAlignment = 'left' | 'center' | 'right'

export type TtmlLyricLine = {
  id: string
  key: string
  agent: string
  alignment: TtmlLyricAlignment
  startTime: number
  endTime: number
  text: string
  words: TtmlLyricWord[]
  backgroundText: string
  backgroundWords: TtmlLyricWord[]
}

export type TtmlLyricDocument = {
  lines: TtmlLyricLine[]
  duration: number | null
}

const TTML_TAG_REGEX = /<tt[\s>]/i

export const isTtmlLyric = (value: string | null | undefined) => {
  return typeof value === 'string' && TTML_TAG_REGEX.test(value)
}

const getAttributeByLocalName = (element: Element, localName: string) => {
  const directValue = element.getAttribute(localName)
    || element.getAttribute(`ttm:${localName}`)
    || element.getAttribute(`itunes:${localName}`)
    || element.getAttribute(`xml:${localName}`)
  if (directValue != null) return directValue

  for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName === localName || attribute.name === localName || attribute.name.endsWith(`:${localName}`)) {
      return attribute.value
    }
  }

  return null
}

const parseTtmlTime = (value: string | null | undefined): number | null => {
  if (!value) return null

  const normalized = value.trim()
  if (!normalized) return null

  if (/^\d+(?:\.\d+)?ms$/i.test(normalized)) return Number.parseFloat(normalized) / 1000
  if (/^\d+(?:\.\d+)?s$/i.test(normalized)) return Number.parseFloat(normalized)
  if (/^\d+(?:\.\d+)?m$/i.test(normalized)) return Number.parseFloat(normalized) * 60
  if (/^\d+(?:\.\d+)?h$/i.test(normalized)) return Number.parseFloat(normalized) * 3600
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number.parseFloat(normalized)

  if (!normalized.includes(':')) return null

  const parts = normalized.split(':').map((item) => Number.parseFloat(item))
  if (!parts.length || parts.some((item) => Number.isNaN(item))) return null
  return parts.reduce((accumulator, current) => accumulator * 60 + current, 0)
}

const getElementsByLocalName = (root: ParentNode, localName: string) => {
  return Array.from(root.querySelectorAll('*')).filter((element) => element.localName === localName)
}

const parseAgentTypes = (doc: Document) => {
  const agentTypes = new Map<string, string>()
  const personAgents: string[] = []

  for (const agent of getElementsByLocalName(doc, 'agent')) {
    const id = getAttributeByLocalName(agent, 'id')
    if (!id) continue

    const type = (agent.getAttribute('type') || '').trim().toLowerCase()
    agentTypes.set(id, type)
    if (type === 'person') personAgents.push(id)
  }

  return { agentTypes, personAgents }
}

const resolveAlignment = (
  agent: string,
  agentTypes: Map<string, string>,
  personAgents: string[],
  fallback: TtmlLyricAlignment,
): TtmlLyricAlignment => {
  if (!agent) return fallback
  if (agentTypes.get(agent) === 'group') return 'center'

  const personIndex = personAgents.indexOf(agent)
  if (personIndex === 0) return 'left'
  if (personIndex === 1) return 'right'
  if (personIndex > 1) return personIndex % 2 === 0 ? 'left' : 'right'

  if (/group|chorus|all|v1000/i.test(agent)) return 'center'
  if (/v2|right|duet-?b/i.test(agent)) return 'right'
  return 'left'
}

const appendTextToWords = (words: TtmlLyricWord[], text: string) => {
  if (!text || !words.length) return
  words[words.length - 1].text += text
}

const collectWordsFromNode = (
  node: Node,
  lineStartTime: number,
  lineEndTime: number,
  targetWords: TtmlLyricWord[],
  backgroundWords: TtmlLyricWord[],
  inheritedBackground = false,
) => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || ''
    if (!text || text.includes('\n')) return
    const normalizedSpace = /^\s+$/.test(text) ? ' ' : text
    appendTextToWords(inheritedBackground ? backgroundWords : targetWords, normalizedSpace)
    return
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return

  const element = node as Element
  const role = (getAttributeByLocalName(element, 'role') || '').trim()
  const isBackground = inheritedBackground || role === 'x-bg'
  const startTime = parseTtmlTime(element.getAttribute('begin')) ?? lineStartTime
  const endTime = parseTtmlTime(element.getAttribute('end')) ?? lineEndTime ?? startTime
  const childElements = Array.from(element.children)
  const rawText = (element.textContent || '').replace(/[\r\n\t]/g, '')

  if (element.localName === 'span' && childElements.length === 0 && rawText) {
    const words = isBackground ? backgroundWords : targetWords
    words.push({
      text: rawText,
      startTime,
      endTime: Math.max(endTime, startTime),
    })
    return
  }

  for (const child of Array.from(element.childNodes)) {
    collectWordsFromNode(child, startTime, endTime, targetWords, backgroundWords, isBackground)
  }
}

const normalizeWords = (words: TtmlLyricWord[]) => {
  return words
    .map((word) => ({
      ...word,
      text: word.text.replace(/\s+/g, ' '),
      endTime: Math.max(word.endTime, word.startTime),
    }))
    .filter((word) => word.text.length > 0)
}

export const parseTtmlLyrics = (
  ttml: string,
  fallbackAlignment: TtmlLyricAlignment = 'center',
): TtmlLyricDocument => {
  if (!isTtmlLyric(ttml) || typeof DOMParser === 'undefined') {
    return { lines: [], duration: null }
  }

  const doc = new DOMParser().parseFromString(ttml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { lines: [], duration: null }
  }

  const { agentTypes, personAgents } = parseAgentTypes(doc)
  const body = getElementsByLocalName(doc, 'body')[0]
  const duration = parseTtmlTime(body?.getAttribute('dur'))
  const paragraphs = getElementsByLocalName(doc, 'p')
  const lines: TtmlLyricLine[] = []

  paragraphs.forEach((paragraph, index) => {
    const parentAgent = paragraph.parentElement ? getAttributeByLocalName(paragraph.parentElement, 'agent') || '' : ''
    const agent = getAttributeByLocalName(paragraph, 'agent') || parentAgent
    const lineStartTime = parseTtmlTime(paragraph.getAttribute('begin'))
    const lineEndTime = parseTtmlTime(paragraph.getAttribute('end')) ?? lineStartTime
    if (lineStartTime == null) return

    const words: TtmlLyricWord[] = []
    const backgroundWords: TtmlLyricWord[] = []
    for (const child of Array.from(paragraph.childNodes)) {
      collectWordsFromNode(child, lineStartTime, lineEndTime ?? lineStartTime, words, backgroundWords)
    }

    const normalizedWords = normalizeWords(words)
    const normalizedBackgroundWords = normalizeWords(backgroundWords)
    const text = normalizedWords.map((word) => word.text).join('').trim()
    const backgroundText = normalizedBackgroundWords.map((word) => word.text).join('').trim()
    if (!text && !backgroundText) return

    const firstWordTime = normalizedWords.find((word) => word.text.trim())?.startTime
      ?? normalizedBackgroundWords.find((word) => word.text.trim())?.startTime
      ?? lineStartTime
    const finalEndTime = lineEndTime
      ?? normalizedWords[normalizedWords.length - 1]?.endTime
      ?? normalizedBackgroundWords[normalizedBackgroundWords.length - 1]?.endTime
      ?? firstWordTime

    lines.push({
      id: `${getAttributeByLocalName(paragraph, 'key') || 'ttml'}-${index}`,
      key: getAttributeByLocalName(paragraph, 'key') || '',
      agent,
      alignment: resolveAlignment(agent, agentTypes, personAgents, fallbackAlignment),
      startTime: firstWordTime,
      endTime: Math.max(finalEndTime, firstWordTime),
      text,
      words: normalizedWords,
      backgroundText,
      backgroundWords: normalizedBackgroundWords,
    })
  })

  lines.sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime)
  return { lines, duration }
}
