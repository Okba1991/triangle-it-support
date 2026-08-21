import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// This page is wired to the "Triangle IT Support" Supabase project - a
// SEPARATE project from the one Spark's Phone Sync uses, so an employee
// account here has zero access to any personal Spark data. The
// publishable key is meant to be public (Supabase's own docs: "safe to
// use in a browser") - real access control is Row Level Security on the
// tables themselves (see supabase/triangle_it_support_schema.sql).
const SUPABASE_URL = 'https://rtytofraoboczpelvpqi.supabase.co'
const SUPABASE_KEY = 'sb_publishable_IPyRE7yRASw-Mh_jVk5uXA_4ztmmS3H'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const authScreen = document.getElementById('auth-screen')
const appScreen = document.getElementById('app-screen')
const authForm = document.getElementById('auth-form')
const authError = document.getElementById('auth-error')
const authHint = document.getElementById('auth-hint')
const authSubmitBtn = document.getElementById('auth-submit-btn')
const logoutBtn = document.getElementById('logout-btn')
const adminTabBtn = document.getElementById('admin-tab-btn')
const dashboardTabBtn = document.getElementById('dashboard-tab-btn')
const manageTabBtn = document.getElementById('manage-tab-btn')
const loadingOverlay = document.getElementById('loading-overlay')
const userIdentity = document.getElementById('user-identity')

const newCompanySelect = document.getElementById('new-company')
const newDepartmentSelect = document.getElementById('new-department')

function refreshDepartmentOptions() {
  newDepartmentSelect.innerHTML = ''
  const depts = taxonomy.departments_by_company[newCompanySelect.value] || []
  depts.forEach((dept) => {
    const opt = document.createElement('option')
    opt.textContent = dept
    newDepartmentSelect.appendChild(opt)
  })
}

newCompanySelect.addEventListener('change', refreshDepartmentOptions)

let currentUserId = null
let isAdmin = false
let profileEmailById = new Map()

// Company/Department/Category/Office pick-lists - editable by the
// admin from "Manage Lists" (see supabase/triangle_it_support_schema.sql's
// ticket_taxonomy table), loaded fresh on every login rather than
// hardcoded, so a list change is visible to everyone immediately.
let taxonomy = { companies: [], departments_by_company: {}, categories: [], offices: [] }

async function loadTaxonomy() {
  const { data, error } = await supabase.from('ticket_taxonomy').select('*').eq('id', 1).single()
  if (error) {
    console.error(error)
    return
  }
  taxonomy = {
    companies: data.companies || [],
    departments_by_company: data.departments_by_company || {},
    categories: data.categories || [],
    offices: data.offices || [],
  }
}

async function saveTaxonomy() {
  await supabase.from('ticket_taxonomy').update({
    companies: taxonomy.companies,
    departments_by_company: taxonomy.departments_by_company,
    categories: taxonomy.categories,
    offices: taxonomy.offices,
    updated_at: nowIso(),
  }).eq('id', 1)
}

function populatePlainSelect(selectEl, options) {
  const current = selectEl.value
  selectEl.innerHTML = ''
  options.forEach((opt) => {
    const o = document.createElement('option')
    o.textContent = opt
    selectEl.appendChild(o)
  })
  if (options.includes(current)) selectEl.value = current
}

function populateFilterSelect(id, options, allLabel) {
  const el = document.getElementById(id)
  const current = el.value
  el.innerHTML = ''
  const allOpt = document.createElement('option')
  allOpt.value = ''
  allOpt.textContent = allLabel
  el.appendChild(allOpt)
  options.forEach((opt) => {
    const o = document.createElement('option')
    o.textContent = opt
    el.appendChild(o)
  })
  if ([...el.options].some((o) => o.value === current)) el.value = current
}

function refreshAllTaxonomyUI() {
  populatePlainSelect(newCompanySelect, taxonomy.companies)
  refreshDepartmentOptions()
  populatePlainSelect(document.getElementById('new-category'), taxonomy.categories)
  populatePlainSelect(document.getElementById('new-office'), taxonomy.offices)

  populateFilterSelect('filter-company', taxonomy.companies, 'All Companies')
  populateFilterSelect('filter-office', taxonomy.offices, 'All Offices')
  populateFilterSelect('filter-category', taxonomy.categories, 'All Categories')

  populateFilterSelect('report-company', taxonomy.companies, 'All Companies')
  populateFilterSelect('report-category', taxonomy.categories, 'All Categories')
  refreshReportDepartmentOptions()

  if (isAdmin) renderManageLists()
}

async function loadProfilesMap() {
  const { data } = await supabase.from('profiles').select('id,email')
  profileEmailById = new Map((data || []).map((p) => [p.id, p.email]))
}

function nowIso() {
  return new Date().toISOString()
}

function showLoading() { loadingOverlay.classList.remove('hidden') }
function hideLoading() { loadingOverlay.classList.add('hidden') }

function statusClass(status) {
  return 'status-' + (status || 'open').toLowerCase().replace(/\s+/g, '-')
}

// Deliberately different from Spark's own format_ticket_ref() ("T#0007")
// so a ticket that started on the website is recognizable at a glance,
// including later once it's pulled into Spark's Tickets tab (M5).
function ticketRef(ticket) {
  return 'W-T#' + String(ticket.ticket_number).padStart(4, '0')
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// ============================== Auth ================================

let authMode = 'signin'

const authTabs = document.getElementById('auth-tabs')
const authPasswordInput = document.getElementById('auth-password')
const forgotPasswordBtn = document.getElementById('forgot-password-btn')
const backToSigninBtn = document.getElementById('back-to-signin-btn')

document.querySelectorAll('.auth-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    authMode = btn.dataset.mode
    authSubmitBtn.textContent = authMode === 'signin' ? 'Sign In' : 'Sign Up'
    authError.textContent = ''
    authHint.classList.add('hidden')
  })
})

function enterResetRequestMode() {
  authMode = 'reset'
  authTabs.classList.add('hidden')
  authPasswordInput.classList.add('hidden')
  authPasswordInput.required = false
  authSubmitBtn.textContent = 'Send Reset Link'
  forgotPasswordBtn.classList.add('hidden')
  backToSigninBtn.classList.remove('hidden')
  authError.textContent = ''
  authHint.classList.add('hidden')
}

function exitResetRequestMode() {
  authMode = 'signin'
  authTabs.classList.remove('hidden')
  authPasswordInput.classList.remove('hidden')
  authPasswordInput.required = true
  authSubmitBtn.textContent = 'Sign In'
  forgotPasswordBtn.classList.remove('hidden')
  backToSigninBtn.classList.add('hidden')
  authError.textContent = ''
  authHint.classList.add('hidden')
  document.querySelectorAll('.auth-tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'signin'))
}

forgotPasswordBtn.addEventListener('click', enterResetRequestMode)
backToSigninBtn.addEventListener('click', exitResetRequestMode)

authForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  authError.textContent = ''
  authHint.classList.add('hidden')

  const email = document.getElementById('auth-email').value.trim()

  if (authMode === 'reset') {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    })
    if (error) {
      authError.textContent = error.message
      return
    }
    authHint.textContent = 'Check your email for a password reset link.'
    authHint.classList.remove('hidden')
    return
  }

  const password = authPasswordInput.value

  if (authMode === 'signup') {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) {
      authError.textContent = error.message
      return
    }
    authHint.textContent = 'Account created — check your email if confirmation is required, then sign in.'
    authHint.classList.remove('hidden')
    return
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    authError.textContent = error.message
    return
  }

  await enterApp()
})

// Supabase parses the recovery tokens out of the URL on page load (the
// link from the reset email lands back here) and fires this event -
// that's the signal to show the "set a new password" screen instead of
// the normal login.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    authScreen.classList.add('hidden')
    appScreen.classList.add('hidden')
    document.getElementById('reset-password-screen').classList.remove('hidden')
  }
})

document.getElementById('new-password-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const password = document.getElementById('new-password-input').value
  const resetError = document.getElementById('reset-error')
  resetError.textContent = ''

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    resetError.textContent = error.message
    return
  }

  document.getElementById('reset-password-screen').classList.add('hidden')
  await enterApp()
})

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut()
  currentUserId = null
  isAdmin = false
  appScreen.classList.add('hidden')
  authScreen.classList.remove('hidden')
})

async function enterApp() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  currentUserId = session.user.id
  userIdentity.textContent = session.user.email

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', currentUserId)
    .single()

  isAdmin = !!(profile && profile.is_admin)
  adminTabBtn.classList.toggle('hidden', !isAdmin)
  dashboardTabBtn.classList.toggle('hidden', !isAdmin)
  manageTabBtn.classList.toggle('hidden', !isAdmin)

  authScreen.classList.add('hidden')
  appScreen.classList.remove('hidden')

  await loadTaxonomy()
  refreshAllTaxonomyUI()

  loadMyTickets()
  if (isAdmin) {
    await loadProfilesMap()
    loadAdminTickets()
    loadDashboard()
  }
}

supabase.auth.getSession().then(({ data }) => {
  if (data.session) enterApp()
})

// ============================== Tabs ================================

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'))
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active')
  })
})

// ============================== Submit ticket ================================

document.getElementById('submit-ticket-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const title = document.getElementById('new-title').value.trim()
  if (!title) return

  const fields = {
    title,
    description: document.getElementById('new-description').value.trim(),
    company: newCompanySelect.value,
    department: newDepartmentSelect.value,
    category: document.getElementById('new-category').value,
    office: document.getElementById('new-office').value,
    status: 'Open',
    solution: '',
    created_at: nowIso(),
    updated_at: nowIso(),
  }

  showLoading()
  const { error } = await supabase.from('tickets').insert(fields)
  hideLoading()

  if (error) {
    alert('Could not submit ticket: ' + error.message)
    return
  }

  e.target.reset()
  refreshDepartmentOptions()

  const successOverlay = document.getElementById('success-overlay')
  successOverlay.classList.remove('hidden')
  setTimeout(() => {
    successOverlay.classList.add('hidden')
    document.querySelector('.tab-btn[data-tab="mine"]').click()
    loadMyTickets()
  }, 1600)
})

// ============================== My tickets ================================

async function loadMyTickets() {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('submitted_by', currentUserId)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error(error)
    return
  }

  renderTicketList(document.getElementById('mine-list'), data, false)
}

// ============================== Admin dashboard ================================

;['filter-status', 'filter-company', 'filter-office', 'filter-category'].forEach((id) => {
  document.getElementById(id).addEventListener('change', loadAdminTickets)
})

// Own tab (not the filtered "All Tickets" list below) - every ticket,
// grouped by status, each group capped with its stat tile and the
// tickets that belong to it right underneath (same shape as Spark's
// own Dashboard tab: a stat card plus the items behind that number).
async function loadDashboard() {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error(error)
    return
  }

  const groups = { Open: [], 'In Progress': [], Resolved: [] }
  data.forEach((t) => {
    if (t.status in groups) groups[t.status].push(t)
  })

  document.getElementById('stat-open').textContent = groups.Open.length
  document.getElementById('stat-in-progress').textContent = groups['In Progress'].length
  document.getElementById('stat-resolved').textContent = groups.Resolved.length

  renderTicketList(document.getElementById('dashboard-open-list'), groups.Open, false, true, openInAdminTab)
  renderTicketList(document.getElementById('dashboard-in-progress-list'), groups['In Progress'], false, true, openInAdminTab)
  renderTicketList(document.getElementById('dashboard-resolved-list'), groups.Resolved, false, true, openInAdminTab)

  renderBreakdown(data)
}

// Same shape as the summary bar at the top of Spark's own Tickets tab
// (By Company / By Department / By Category / By Month counts) -
// scoped to every ticket, not just the currently-visible dashboard
// columns. countBy() is defined further down (Report export section)
// but function declarations are hoisted, so it's available here too.
function renderBreakdown(tickets) {
  const el = document.getElementById('dashboard-breakdown')
  el.innerHTML = ''

  function line(label, counts) {
    const p = document.createElement('div')
    const strong = document.createElement('strong')
    strong.textContent = label + ': '
    p.appendChild(strong)
    p.append(counts.length ? counts.map(([k, v]) => `${k}: ${v}`).join('   ') : '(none)')
    el.appendChild(p)
  }

  line('By Company', countBy(tickets, (t) => t.company))
  line('By Department', countBy(tickets, (t) => t.department))
  line('By Category', countBy(tickets, (t) => t.category))

  const monthCounts = new Map()
  tickets.forEach((t) => {
    if (!t.created_at) return
    const d = new Date(t.created_at)
    const key = `${d.getMonth() + 1}/${d.getFullYear()}`
    monthCounts.set(key, (monthCounts.get(key) || 0) + 1)
  })
  line('By Month', [...monthCounts.entries()])
}

// Clicking a ticket on the Dashboard jumps to it on the editable "All
// Tickets" tab - reset any active filters first so it's guaranteed to
// be in the (re-fetched) list, then scroll to and briefly flash it.
async function openInAdminTab(ticket) {
  document.querySelector('.tab-btn[data-tab="admin"]').click()

  document.getElementById('filter-status').value = ''
  document.getElementById('filter-company').value = ''
  document.getElementById('filter-office').value = ''
  document.getElementById('filter-category').value = ''
  await loadAdminTickets()

  const card = document.querySelector(`#admin-list [data-ticket-id="${ticket.id}"]`)
  if (!card) return

  card.scrollIntoView({ behavior: 'smooth', block: 'center' })
  card.classList.add('ticket-highlight')
  setTimeout(() => card.classList.remove('ticket-highlight'), 1500)
}

async function loadAdminTickets() {
  let query = supabase.from('tickets').select('*').order('updated_at', { ascending: false })

  const status = document.getElementById('filter-status').value
  const company = document.getElementById('filter-company').value
  const office = document.getElementById('filter-office').value
  const category = document.getElementById('filter-category').value

  if (status) query = query.eq('status', status)
  if (company) query = query.eq('company', company)
  if (office) query = query.eq('office', office)
  if (category) query = query.eq('category', category)

  const { data, error } = await query

  if (error) {
    console.error(error)
    return
  }

  renderTicketList(document.getElementById('admin-list'), data, true, true)
}

// ============================== Rendering ================================

function renderTicketList(listEl, tickets, adminMode, showRequester, onCardClick) {
  listEl.innerHTML = ''

  if (tickets.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty-hint'
    li.textContent = 'No tickets yet.'
    listEl.appendChild(li)
    return
  }

  tickets.forEach((ticket) => {
    const li = document.createElement('li')
    li.className = 'ticket-card'
    li.dataset.ticketId = ticket.id

    if (onCardClick) {
      li.classList.add('clickable')
      li.addEventListener('click', () => onCardClick(ticket))
    }

    const top = document.createElement('div')
    top.className = 'ticket-card-top'

    const left = document.createElement('div')
    const title = document.createElement('div')
    title.className = 'ticket-title'
    title.textContent = `${ticketRef(ticket)} — ${ticket.title}`
    left.appendChild(title)

    const meta = document.createElement('div')
    meta.className = 'ticket-meta'
    meta.textContent = [
      formatDateTime(ticket.created_at),
      showRequester ? (profileEmailById.get(ticket.submitted_by) || 'Unknown submitter') : null,
      ticket.company, ticket.department, ticket.category, ticket.office,
    ].filter(Boolean).join(' · ')
    left.appendChild(meta)

    top.appendChild(left)

    const badge = document.createElement('span')
    badge.className = 'status-badge ' + statusClass(ticket.status)
    badge.textContent = ticket.status
    top.appendChild(badge)

    li.appendChild(top)

    if (ticket.description) {
      const desc = document.createElement('div')
      desc.className = 'ticket-desc'
      desc.textContent = ticket.description
      li.appendChild(desc)
    }

    if (!adminMode && ticket.solution) {
      const sol = document.createElement('div')
      sol.className = 'ticket-solution'
      sol.textContent = 'Solution: ' + ticket.solution
      li.appendChild(sol)
    }

    if (adminMode) {
      const controls = document.createElement('div')
      controls.className = 'admin-controls'

      const statusSelect = document.createElement('select')
      ;['Open', 'In Progress', 'Resolved'].forEach((s) => {
        const opt = document.createElement('option')
        opt.value = s
        opt.textContent = s
        opt.selected = s === ticket.status
        statusSelect.appendChild(opt)
      })

      const solutionInput = document.createElement('textarea')
      solutionInput.rows = 1
      solutionInput.placeholder = 'Solution / notes...'
      solutionInput.value = ticket.solution || ''

      const saveBtn = document.createElement('button')
      saveBtn.textContent = 'Save'
      saveBtn.addEventListener('click', () => updateTicket(ticket.id, statusSelect.value, solutionInput.value))

      controls.append(statusSelect, solutionInput, saveBtn)
      li.appendChild(controls)
    }

    listEl.appendChild(li)
  })
}

// ============================== Report export ================================

const reportCompanySelect = document.getElementById('report-company')
const reportDepartmentSelect = document.getElementById('report-department')

function refreshReportDepartmentOptions() {
  const company = reportCompanySelect.value
  const companies = company ? [company] : taxonomy.companies

  const options = []
  companies.forEach((c) => {
    ;(taxonomy.departments_by_company[c] || []).forEach((d) => {
      if (!options.includes(d)) options.push(d)
    })
  })

  reportDepartmentSelect.innerHTML = '<option value="">All Departments</option>'
  options.forEach((d) => {
    const opt = document.createElement('option')
    opt.textContent = d
    reportDepartmentSelect.appendChild(opt)
  })
}

reportCompanySelect.addEventListener('change', refreshReportDepartmentOptions)

const UNSET_LABEL = 'Unset'

// Same palette as Spark's own ticket report (services/ticket_report.py).
const STATUS_FILL_COLORS = { Open: '2F6FED', 'In Progress': 'D9A441', Resolved: '3ECF8E' }
const HEADER_FONT = { bold: true, color: { rgb: 'FFFFFF' } }
const HEADER_FILL = { fgColor: { rgb: '303030' } }
const SECTION_FONT = { bold: true, sz: 12 }

function styleCell(sheet, row, col, style) {
  const ref = XLSX.utils.encode_cell({ r: row, c: col })
  if (!sheet[ref]) sheet[ref] = { t: 's', v: '' }
  sheet[ref].s = { ...(sheet[ref].s || {}), ...style }
}

function countBy(tickets, keyFn) {
  const counts = new Map()
  tickets.forEach((t) => {
    const key = keyFn(t) || UNSET_LABEL
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

document.getElementById('export-report-btn').addEventListener('click', async () => {
  const fromStr = document.getElementById('report-from').value
  const toStr = document.getElementById('report-to').value

  if (!fromStr || !toStr) {
    alert('Pick both a From and To date.')
    return
  }
  if (fromStr > toStr) {
    alert('"From" must be on or before "To".')
    return
  }

  const status = document.getElementById('report-status').value
  const company = reportCompanySelect.value
  const department = reportDepartmentSelect.value
  const category = document.getElementById('report-category').value

  let query = supabase
    .from('tickets')
    .select('*')
    .gte('created_at', fromStr + 'T00:00:00')
    .lte('created_at', toStr + 'T23:59:59')
    .order('created_at', { ascending: true })

  if (status) query = query.eq('status', status)
  if (company) query = query.eq('company', company)
  if (department) query = query.eq('department', department)
  if (category) query = query.eq('category', category)

  const { data: tickets, error } = await query
  if (error) {
    alert('Could not build report: ' + error.message)
    return
  }

  const { data: profiles } = await supabase.from('profiles').select('id,email')
  const emailById = new Map((profiles || []).map((p) => [p.id, p.email]))

  const wb = XLSX.utils.book_new()

  // ---- Summary sheet ----
  const filtersText = [
    status && `Status: ${status}`,
    company && `Company: ${company}`,
    department && `Department: ${department}`,
    category && `Category: ${category}`,
  ].filter(Boolean).join(' | ') || 'None'

  const monthCounts = new Map()
  tickets.forEach((t) => {
    if (!t.created_at) return
    const d = new Date(t.created_at)
    const key = `${d.getMonth() + 1}/${d.getFullYear()}`
    monthCounts.set(key, (monthCounts.get(key) || 0) + 1)
  })

  const sectionStarts = []
  let totalRow = 0

  const summaryRows = [
    ['Tickets Report Summary'],
    [`Date range (created): ${fromStr} to ${toStr}`],
    [`Filters: ${filtersText}`],
    [`Total tickets: ${tickets.length}`],
    [],
  ]
  totalRow = 3

  ;[
    ['By Company', countBy(tickets, (t) => t.company)],
    ['By Department', countBy(tickets, (t) => t.department)],
    ['By Category', countBy(tickets, (t) => t.category)],
    ['By Status', countBy(tickets, (t) => t.status)],
    ['By Month', [...monthCounts.entries()]],
  ].forEach(([label, items]) => {
    sectionStarts.push(summaryRows.length)
    summaryRows.push([label])
    if (items.length === 0) summaryRows.push(['(none)'])
    else items.forEach((row) => summaryRows.push(row))
    summaryRows.push([])
  })

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
  summarySheet['!cols'] = [{ wch: 26 }, { wch: 12 }]

  styleCell(summarySheet, 0, 0, { font: { bold: true, sz: 14 } })
  styleCell(summarySheet, totalRow, 0, { font: { bold: true } })
  sectionStarts.forEach((row) => styleCell(summarySheet, row, 0, SECTION_FONT))

  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')

  // ---- Detailed sheet ----
  const detailHeader = [
    'Ref', 'Title', 'Submitted By', 'Status', 'Company', 'Department',
    'Category', 'Office', 'Created', 'Updated', 'Resolved', 'Description', 'Solution',
  ]
  const detailRows = tickets.map((t) => [
    ticketRef(t),
    t.title,
    emailById.get(t.submitted_by) || '',
    t.status,
    t.company || '',
    t.department || '',
    t.category || '',
    t.office || '',
    formatDateTime(t.created_at),
    formatDateTime(t.updated_at),
    t.resolved_at ? formatDateTime(t.resolved_at) : '',
    t.description || '',
    t.solution || '',
  ])

  const detailSheet = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows])
  detailSheet['!cols'] = [
    { wch: 12 }, { wch: 36 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 18 },
    { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 44 }, { wch: 44 },
  ]
  detailSheet['!freeze'] = { xSplit: 0, ySplit: 1 }

  const STATUS_COL = 3 // 0-indexed: Ref,Title,Submitted By,Status
  const WRAP_COLS = [1, 11, 12] // Title, Description, Solution

  detailHeader.forEach((_, col) => {
    styleCell(detailSheet, 0, col, { font: HEADER_FONT, fill: { patternType: 'solid', ...HEADER_FILL } })
  })

  detailRows.forEach((row, rowIndex) => {
    const r = rowIndex + 1
    row.forEach((_, col) => {
      styleCell(detailSheet, r, col, {
        alignment: { vertical: 'top', wrapText: WRAP_COLS.includes(col) },
      })
    })

    const fillColor = STATUS_FILL_COLORS[row[STATUS_COL]]
    if (fillColor) {
      styleCell(detailSheet, r, STATUS_COL, {
        font: { color: { rgb: 'FFFFFF' }, bold: true },
        fill: { patternType: 'solid', fgColor: { rgb: fillColor } },
      })
    }
  })

  XLSX.utils.book_append_sheet(wb, detailSheet, 'Detailed')

  XLSX.writeFile(wb, `Tickets_Report_${fromStr}_to_${toStr}.xlsx`)
})

async function updateTicket(id, status, solution) {
  const fields = { status, solution, updated_at: nowIso() }
  if (status === 'Resolved') fields.resolved_at = nowIso()

  const { error } = await supabase.from('tickets').update(fields).eq('id', id)
  if (error) {
    alert('Could not update ticket: ' + error.message)
    return
  }
  loadAdminTickets()
  loadDashboard()
}

// ============================== Manage Lists ================================

const manageDeptCompanySelect = document.getElementById('manage-dept-company')

function renderChipList(containerId, items, onRemove) {
  const container = document.getElementById(containerId)
  container.innerHTML = ''

  if (items.length === 0) {
    const empty = document.createElement('span')
    empty.className = 'hint-text'
    empty.textContent = 'None yet.'
    container.appendChild(empty)
    return
  }

  items.forEach((item) => {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.append(document.createTextNode(item))

    const removeBtn = document.createElement('button')
    removeBtn.type = 'button'
    removeBtn.textContent = '×'
    removeBtn.title = 'Remove'
    removeBtn.addEventListener('click', () => onRemove(item))
    chip.appendChild(removeBtn)

    container.appendChild(chip)
  })
}

function renderDepartmentChips() {
  const company = manageDeptCompanySelect.value
  const depts = taxonomy.departments_by_company[company] || []
  renderChipList('manage-departments', depts, (name) => removeDepartment(company, name))
}

function renderManageLists() {
  renderChipList('manage-companies', taxonomy.companies, removeCompany)
  renderChipList('manage-categories', taxonomy.categories, (name) => removeSimple('categories', name))
  renderChipList('manage-offices', taxonomy.offices, (name) => removeSimple('offices', name))

  populatePlainSelect(manageDeptCompanySelect, taxonomy.companies)
  renderDepartmentChips()
}

manageDeptCompanySelect.addEventListener('change', renderDepartmentChips)

async function removeSimple(listKey, value) {
  taxonomy[listKey] = taxonomy[listKey].filter((v) => v !== value)
  await saveTaxonomy()
  refreshAllTaxonomyUI()
}

async function removeCompany(name) {
  taxonomy.companies = taxonomy.companies.filter((c) => c !== name)
  delete taxonomy.departments_by_company[name]
  await saveTaxonomy()
  refreshAllTaxonomyUI()
}

async function removeDepartment(company, name) {
  taxonomy.departments_by_company[company] = (taxonomy.departments_by_company[company] || []).filter((d) => d !== name)
  await saveTaxonomy()
  refreshAllTaxonomyUI()
}

function wireAddForm(formId, listKey) {
  document.getElementById(formId).addEventListener('submit', async (e) => {
    e.preventDefault()
    const input = e.target.querySelector('input')
    const value = input.value.trim()
    if (!value || taxonomy[listKey].includes(value)) return

    taxonomy[listKey].push(value)
    if (listKey === 'companies' && !taxonomy.departments_by_company[value]) {
      taxonomy.departments_by_company[value] = []
    }

    input.value = ''
    await saveTaxonomy()
    refreshAllTaxonomyUI()
  })
}

wireAddForm('add-company-form', 'companies')
wireAddForm('add-category-form', 'categories')
wireAddForm('add-office-form', 'offices')

document.getElementById('add-department-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const company = manageDeptCompanySelect.value
  if (!company) return

  const input = e.target.querySelector('input')
  const value = input.value.trim()
  if (!value) return

  if (!taxonomy.departments_by_company[company]) taxonomy.departments_by_company[company] = []
  if (taxonomy.departments_by_company[company].includes(value)) return

  taxonomy.departments_by_company[company].push(value)
  input.value = ''
  await saveTaxonomy()
  refreshAllTaxonomyUI()
})
