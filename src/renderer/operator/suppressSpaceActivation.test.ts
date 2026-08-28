// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest'
import { suppressSpaceActivation } from './suppressSpaceActivation'

beforeEach(() => {
  document.addEventListener('keydown', suppressSpaceActivation, true)
})
afterEach(() => {
  document.removeEventListener('keydown', suppressSpaceActivation, true)
  document.body.innerHTML = ''
})

function press(target: Element, key: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(e)
  return e
}

test('Space on a focused button is prevented, so the button cannot activate', () => {
  const btn = document.createElement('button')
  document.body.appendChild(btn)
  btn.focus()
  expect(press(btn, ' ').defaultPrevented).toBe(true)
})

test('Enter on a focused button is left alone', () => {
  const btn = document.createElement('button')
  document.body.appendChild(btn)
  btn.focus()
  expect(press(btn, 'Enter').defaultPrevented).toBe(false)
})

test('Space in an input or textarea still types a space', () => {
  const input = document.createElement('input')
  const area = document.createElement('textarea')
  document.body.append(input, area)
  input.focus()
  expect(press(input, ' ').defaultPrevented).toBe(false)
  area.focus()
  expect(press(area, ' ').defaultPrevented).toBe(false)
})

test('Space inside a role="menu" is left to the menu (ContextMenu handles its own keys)', () => {
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  const item = document.createElement('button')
  menu.appendChild(item)
  document.body.appendChild(menu)
  item.focus()
  expect(press(item, ' ').defaultPrevented).toBe(false)
})

test('Space with nothing focused is left alone', () => {
  expect(press(document.body, ' ').defaultPrevented).toBe(false)
})
