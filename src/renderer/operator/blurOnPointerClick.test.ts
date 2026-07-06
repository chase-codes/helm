// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest'
import { blurOnPointerClick } from './blurOnPointerClick'

beforeEach(() => {
  document.addEventListener('click', blurOnPointerClick)
})
afterEach(() => {
  document.removeEventListener('click', blurOnPointerClick)
  document.body.innerHTML = ''
})

function addButton(): HTMLButtonElement {
  const btn = document.createElement('button')
  document.body.appendChild(btn)
  return btn
}

test('blurs a pointer-clicked button so it does not retain focus', () => {
  const btn = addButton()
  btn.focus()
  expect(document.activeElement).toBe(btn)
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  expect(document.activeElement).not.toBe(btn)
})

test('keeps focus for a keyboard-activated click (detail 0)', () => {
  const btn = addButton()
  btn.focus()
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
  expect(document.activeElement).toBe(btn)
})

test('blurs when the click originates on a child element inside the button', () => {
  const btn = addButton()
  const span = document.createElement('span')
  btn.appendChild(span)
  btn.focus()
  span.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  expect(document.activeElement).not.toBe(btn)
})

test('ignores a pointer click that is not on a button (no throw, focus unchanged)', () => {
  const input = document.createElement('input')
  document.body.appendChild(input)
  input.focus()
  const div = document.createElement('div')
  document.body.appendChild(div)
  div.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  expect(document.activeElement).toBe(input)
})
