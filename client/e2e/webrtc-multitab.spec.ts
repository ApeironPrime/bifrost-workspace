import { expect, test } from '@playwright/test'

test('Two real browser contexts connect via 1-click invite and exchange P2P Chat + Video', async ({
  browser,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  const aliceEmail = `alice-e2e-${suffix}@bifrost.dev`
  const bobEmail = `bob-e2e-${suffix}@bifrost.dev`
  const password = 'Password123!'

  const contextAlice = await browser.newContext({ permissions: ['camera', 'microphone'] })
  const contextBob = await browser.newContext({ permissions: ['camera', 'microphone'] })

  const alice = await contextAlice.newPage()
  const bob = await contextBob.newPage()

  try {
    // 1. Alice registers & completes onboarding
    await alice.goto('/#workspace')
    await alice.locator('.auth-switch-copy button').click()
    await alice.locator('#auth-name').fill('Alice E2E')
    await alice.locator('#auth-email').fill(aliceEmail)
    await alice.locator('#auth-password').fill(password)
    await alice.locator('#auth-confirm').fill(password)
    await alice.locator('button.auth-submit').click()

    const aliceSaveProfile = alice.getByRole('button', { name: /Lưu và tiếp tục|Save and continue/i })
    await aliceSaveProfile.waitFor({ state: 'visible' })
    await aliceSaveProfile.click()

    // 2. Alice creates Workspace "E2E Studio"
    await alice.locator('.sidebar-add-ws-btn').waitFor({ state: 'visible' })
    await alice.locator('.sidebar-add-ws-btn').click()
    await alice.locator('#modal-workspace-name').fill('E2E Studio')
    await alice.locator('.workspace-create-modal button[type="submit"]').click()
    await expect(alice.locator('.hero-greeting')).toHaveText('E2E Studio')

    // 3. Alice creates Room "Design Sync"
    await alice.locator('.sidebar-action-btn').click()
    await alice.locator('#modal-room-name').fill('Design Sync')
    await alice.locator('.room-create-modal button[type="submit"]').click()
    await expect(alice.locator('.workspace-room-row h3', { hasText: 'Design Sync' })).toBeVisible()

    // 4. Alice generates a 1-click invite link
    await alice.locator('.header-right .btn-outline-header').click()
    await alice.locator('.invite-member-modal .btn-secondary', { hasText: /liên kết|invite link|招待リンク/i }).click()
    const inviteInput = alice.locator('.invite-member-modal input[readonly]')
    await expect(inviteInput).toHaveValue(/#invite=/)
    const inviteUrl = await inviteInput.inputValue()
    await alice.locator('.invite-member-modal .modal-header .btn-icon').click()

    // 5. Bob opens the 1-click invite link, registers & joins E2E Studio automatically
    await bob.goto(inviteUrl)
    await bob.locator('.auth-switch-copy button').click()
    await bob.locator('#auth-name').fill('Bob E2E')
    await bob.locator('#auth-email').fill(bobEmail)
    await bob.locator('#auth-password').fill(password)
    await bob.locator('#auth-confirm').fill(password)
    await bob.locator('button.auth-submit').click()

    const bobSaveProfile = bob.getByRole('button', { name: /Lưu và tiếp tục|Save and continue/i })
    await Promise.race([
      bobSaveProfile.waitFor({ state: 'visible' }).then(() => bobSaveProfile.click()),
      bob.locator('.hero-greeting', { hasText: 'E2E Studio' }).waitFor({ state: 'visible' }),
    ])
    await expect(bob.locator('.hero-greeting')).toHaveText('E2E Studio', { timeout: 20_000 })

    // 6. Alice reloads to see Bob in WorkspaceMembers, then assigns Bob to "Design Sync"
    await alice.reload()
    const manageBobBtn = alice.locator('button[aria-label*="Bob E2E"]').first()
    await manageBobBtn.waitFor({ state: 'visible', timeout: 15_000 })
    await manageBobBtn.click()
    const roleDialog = alice.locator('.member-edit-modal')
    await roleDialog.waitFor({ state: 'visible' })
    const roomTrigger = roleDialog.locator('.select-menu-trigger').first()
    if (await roomTrigger.isVisible()) {
      await roomTrigger.click()
      await alice.locator('.select-menu-option', { hasText: 'Design Sync' }).first().click()
    }
    const saveMemberBtn = roleDialog.locator('.member-edit-actions .btn-primary').first()
    await saveMemberBtn.click()
    await roleDialog.waitFor({ state: 'hidden' })

    // 7. Both Alice and Bob enter "Design Sync"
    await alice.locator('.workspace-room-row .room-enter-btn').first().click()
    await alice.locator('.room-tabs-nav').waitFor({ state: 'visible' })

    await bob.reload()
    await expect(bob.locator('.workspace-room-row .room-enter-btn').first()).toBeEnabled({
      timeout: 15_000,
    })
    await bob.locator('.workspace-room-row .room-enter-btn').first().click()
    await bob.locator('.room-tabs-nav').waitFor({ state: 'visible' })

    // 8. Verify real WebRTC P2P connection (2 peers + P2P connected status pill)
    await expect(alice.locator('.header-room-context .p2p-status-pill.tone-connected')).toBeVisible({
      timeout: 20_000,
    })
    await expect(bob.locator('.header-room-context .p2p-status-pill.tone-connected')).toBeVisible({
      timeout: 20_000,
    })

    // 9. Verify real P2P DataChannel Chat delivery
    await alice.locator('#room-tab-chat').click()
    await bob.locator('#room-tab-chat').click()
    await alice.locator('#room-panel-chat textarea').fill('Hello over P2P DataChannel!')
    await alice.locator('#room-panel-chat button[type="submit"]').click()
    await expect(bob.locator('#room-panel-chat')).toContainText('Hello over P2P DataChannel!', {
      timeout: 15_000,
    })

    // 10. Verify real WebRTC Video track over fake media stream
    await alice.locator('#room-tab-meeting').click()
    await bob.locator('#room-tab-meeting').click()
    await alice.locator('#room-panel-meeting button[aria-pressed]').nth(1).click()
    await expect(bob.locator('#room-panel-meeting video').first()).toBeVisible({ timeout: 15_000 })
  } finally {
    await contextAlice.close()
    await contextBob.close()
  }
})
