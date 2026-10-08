// Surface emulator-browser failures in the check annotations as well as the job log.
// These suites use only disposable demo-project accounts and fixture signing keys.
const escape = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')

export default async function* report(events) {
  for await (const event of events) {
    if (process.env.GITHUB_ACTIONS !== 'true' || event.type !== 'test:fail') continue
    const { name, details } = event.data
    const error = details?.error
    if (error?.failureType === 'subtestsFailed') continue
    const message = String(error?.cause?.message ?? error?.message ?? 'Test failed').slice(0,2000)
    yield `::error::${escape(name)}%0A${escape(message)}\n`
  }
}
