// Extracted from settings/page.tsx. Budget panel: single-input form that
// sets the monthly $ ceiling used by the Stats page to flag overage risk.

'use client'

import { API_BASE } from '@/lib/config'

interface BudgetTabProps {
  budgetLimit: string
  setBudgetLimit: (v: string) => void
  budgetSaving: boolean
  setBudgetSaving: (v: boolean) => void
  budgetSaved: boolean
  setBudgetSaved: (v: boolean) => void
}

export function BudgetTab({
  budgetLimit,
  setBudgetLimit,
  budgetSaving,
  setBudgetSaving,
  budgetSaved,
  setBudgetSaved,
}: BudgetTabProps) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Budget Threshold</h2>
        <p className="text-sm text-gray-500 mt-1">Set a monthly budget limit. The Stats page will warn you if projected costs exceed this amount.</p>
      </div>
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Monthly Budget Limit ($)</label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">$</span>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={budgetLimit}
                  onChange={(e) => setBudgetLimit(e.target.value)}
                  placeholder="e.g. 50.00"
                  className="block w-full pl-7 pr-12 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Leave empty or set to 0 to disable budget warnings.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  setBudgetSaving(true)
                  try {
                    await fetch(`${API_BASE}/v1/stats/budget`, {
                      method: 'PATCH',
                      headers: { 'Authorization': 'Bearer modelmesh_local_dev_key', 'Content-Type': 'application/json' },
                      body: JSON.stringify({ budget_limit: parseFloat(budgetLimit) || 0 }),
                    })
                    setBudgetSaved(true)
                    setTimeout(() => setBudgetSaved(false), 2500)
                  } catch (e) {
                    console.error('Failed to save budget:', e)
                  } finally {
                    setBudgetSaving(false)
                  }
                }}
                disabled={budgetSaving}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300"
              >
                {budgetSaving ? 'Saving…' : 'Save Budget'}
              </button>
              {budgetSaved && <span className="text-sm text-green-600 font-medium animate-pulse">Saved!</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
