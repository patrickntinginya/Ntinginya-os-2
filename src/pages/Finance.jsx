import { useState } from 'react'
import PageHeader from '../components/ui/PageHeader'
import Tabs from '../components/ui/Tabs'
import FinanceOverview from '../components/finance/FinanceOverview'
import TransactionsTab from '../components/finance/TransactionsTab'
import BudgetsTab from '../components/finance/BudgetsTab'
import SavingsTab from '../components/finance/SavingsTab'
import RecurringTab from '../components/finance/RecurringTab'
import CategoriesTab from '../components/finance/CategoriesTab'
import IntelligenceTab from '../components/finance/IntelligenceTab'
import { tr } from '../i18n'

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'smart', label: 'Smart' },
  { value: 'budgets', label: 'Budgets' },
  { value: 'savings', label: 'Savings' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'categories', label: 'Categories' },
]

export default function Finance() {
  const [tab, setTab] = useState('overview')
  return (
    <div>
      <PageHeader title={tr('Finance')} subtitle={tr('All amounts are in Tanzanian Shillings (TSh).')} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} label={tr('Finance sections')} />
      {tab === 'overview' && <FinanceOverview />}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'smart' && <IntelligenceTab />}
      {tab === 'budgets' && <BudgetsTab />}
      {tab === 'savings' && <SavingsTab />}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'categories' && <CategoriesTab />}
    </div>
  )
}
