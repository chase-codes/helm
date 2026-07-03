import electronLogo from './assets/electron.svg'

function App(): React.JSX.Element {
  return (
    <>
      <img alt="logo" className="logo" src={electronLogo} />
      <div className="creator">Helm</div>
      <div className="text">Operator shell placeholder — built out in later tasks.</div>
    </>
  )
}

export default App
