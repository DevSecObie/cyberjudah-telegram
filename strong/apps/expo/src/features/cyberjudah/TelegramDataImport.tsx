// CyberJudah: once on each device, brings in what the reader saved in the CyberJudah Telegram app
// (highlights, notes, links, bookmarks, tags and custom colours). It only adds: anything already
// here wins, and the Telegram app's own copy is never changed.
import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import type { RootState } from '~redux/modules/reducer'
import { mergeImportedBibleData } from '~redux/modules/user'
import { toast } from '~helpers/toast'
import { convertTelegramData, countImported, TELEGRAM_IMPORT_VERSION } from './telegramImport'
import { readTelegramAppValues } from './telegramStorage'

const TelegramDataImport = () => {
  const dispatch = useDispatch()
  const done = useSelector((state: RootState) => state.user.telegramImport?.version === TELEGRAM_IMPORT_VERSION)
  useEffect(() => {
    if (done) return
    let live = true
    void readTelegramAppValues().then(values => {
      if (!live) return
      const data = convertTelegramData(values)
      const count = countImported(data)
      // Nothing saved yet: look again next time, in case the reader saves in the Telegram app first.
      if (!count) return
      dispatch(mergeImportedBibleData({ data, version: TELEGRAM_IMPORT_VERSION, count }))
      toast.success('Your highlights, notes and bookmarks from the CyberJudah app are here.')
    })
    return () => {
      live = false
    }
  }, [done, dispatch])
  return null
}

export default TelegramDataImport
