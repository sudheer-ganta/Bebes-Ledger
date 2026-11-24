import { useEffect } from 'react'
import { AppProvider } from './lib/store'
import { useRouteInfo } from './lib/route'
import { Layout } from './components/Layout'
import { Today } from './pages/Today'
import { WalletPage } from './pages/Wallet'
import { Groceries } from './pages/Groceries'
import { Todo } from './pages/Todo'
import { Body } from './pages/Body'
import { CalendarPage } from './pages/Calendar'
import { Journal } from './pages/Journal'
import { Crisis } from './pages/Crisis'
import { SettingsPage } from './pages/Settings'

function Router() {
  const { route, param } = useRouteInfo()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [route])
  return (
    <Layout route={route}>
      {route === 'today' && <Today />}
      {route === 'wallet' && <WalletPage />}
      {route === 'food' && <Groceries />}
      {route === 'todo' && <Todo />}
      {route === 'body' && <Body />}
      {route === 'calendar' && <CalendarPage />}
      {route === 'journal' && <Journal />}
      {route === 'crisis' && <Crisis initial={param} />}
      {route === 'settings' && <SettingsPage />}
    </Layout>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  )
}
