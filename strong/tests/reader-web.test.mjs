import test from 'node:test'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { openReader } from './web-harness.mjs'

test('touch long press opens the original lexicon sheet with the CyberJudah Strong publication', { timeout: 90_000 }, async t => {
  const { context, page, errors } = await openReader(t)
  const point = await page.locator('[data-verse-key="1-1-1"]').evaluate(el => {
    const text = [...el.childNodes].find(node => node.nodeType === Node.TEXT_NODE)
    const range = document.createRange()
    range.selectNodeContents(text || el)
    const rect = range.getClientRects()[0]
    return { x: rect.x + 30, y: rect.y + rect.height / 2 }
  })
  const touch = await context.newCDPSession(page)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await page.waitForTimeout(750)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('button', { name: 'In the beginning', exact: true })).toBeVisible()
  await expect(page.getByText('H7225', { exact: true })).toBeVisible()
  await expect(page.getByText('rêʼshîyth · ray-sheeth\' · רֵאשִׁית', { exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
})

test('a free note created through New Tab survives saving, editing and a browser reload', { timeout: 90_000 }, async t => {
  const { page, errors } = await openReader(t)
  await page.getByRole('button', { name: 'Tabs, 1 open', exact: true }).tap()
  await page.getByRole('button', { name: 'Add a tab', exact: true }).tap()
  await page.getByTestId('new-tab-tool-notes').tap()
  await page.getByText('Create a note', { exact: true }).tap()
  await page.getByRole('textbox', { name: 'Title (optional)', exact: true }).fill('Reader parity note')
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('A free note saved in the original editor.')
  await page.getByRole('button', { name: 'Save', exact: true }).tap()
  await expect(page).toHaveURL(/\/note\?noteId=[^&]+$/)
  await expect(page.getByText('A free note saved in the original editor.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Reader parity note', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit note', exact: true }).tap()
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Edited note retained after reload.')
  await page.getByRole('button', { name: 'Save', exact: true }).tap()
  await expect(page.getByText('Edited note retained after reload.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Edited note retained after reload.', { exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
})
