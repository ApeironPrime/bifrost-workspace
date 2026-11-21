export type SelectItem = {
  value: string
  label: string
  description?: string
  disabled?: boolean
  lang?: string
  tone?: 'default' | 'danger'
}

export function searchKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase()
    .trim()
}

export function filterSelectItems<T extends SelectItem>(items: T[], query: string): T[] {
  const key = searchKey(query)
  return key
    ? items.filter((item) => searchKey(`${item.label} ${item.description ?? ''}`).includes(key))
    : items
}

export function moveSelectIndex(index: number, length: number, direction: 1 | -1) {
  return length > 0 ? (index + direction + length) % length : -1
}
