import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Branch, BranchType } from '../../../models/branch'
import { git } from '../../../lib/git/core'
import { getBranches } from '../../../lib/git/for-each-ref'
import { getSymbolicRef } from '../../../lib/git/refs'
import { Dispatcher } from '../../dispatcher'
import { TextBox } from '../../lib/text-box'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'

interface IArborGraphSidebarProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  /** Show the commit a ref points at in the graph. */
  readonly onSelectRef: (name: string) => void
}

interface IArborGraphSidebarState {
  readonly local: ReadonlyArray<Branch>
  /** Remote branches grouped by remote name. */
  readonly remotes: ReadonlyMap<string, ReadonlyArray<Branch>>
  readonly tags: ReadonlyArray<string>
  readonly current: string | null
  readonly filter: string
  readonly collapsed: ReadonlySet<string>
}

/**
 * Arbor: the sidebar of the Graph tab, listing local branches, remotes and
 * tags like the left panel of GitKraken. Clicking an entry shows it in the
 * graph; double-clicking a local branch checks it out.
 */
export class ArborGraphSidebar extends React.Component<
  IArborGraphSidebarProps,
  IArborGraphSidebarState
> {
  private isMounted = false

  public constructor(props: IArborGraphSidebarProps) {
    super(props)
    this.state = {
      local: [],
      remotes: new Map(),
      tags: [],
      current: null,
      filter: '',
      collapsed: new Set(),
    }
  }

  public componentDidMount() {
    this.isMounted = true
    this.load()
  }

  public componentWillUnmount() {
    this.isMounted = false
  }

  private async load() {
    const { repository } = this.props
    try {
      const [branches, headRef, tags] = await Promise.all([
        getBranches(repository),
        getSymbolicRef(repository, 'HEAD'),
        git(
          [
            'for-each-ref',
            '--sort=-creatordate',
            '--format=%(refname:short)',
            'refs/tags',
          ],
          repository.path,
          'arborGraphTags'
        ),
      ])

      const remotes = new Map<string, Array<Branch>>()
      for (const b of branches) {
        if (b.type === BranchType.Remote && !b.name.endsWith('/HEAD')) {
          const remote = b.remoteName ?? b.name.split('/')[0]
          remotes.set(remote, [...(remotes.get(remote) ?? []), b])
        }
      }

      if (this.isMounted) {
        this.setState({
          local: branches.filter(b => b.type === BranchType.Local),
          remotes,
          tags: tags.stdout.split('\n').filter(t => t.length > 0),
          current:
            headRef !== null && headRef.startsWith('refs/heads/')
              ? headRef.substring('refs/heads/'.length)
              : null,
        })
      }
    } catch (e) {
      log.error(
        'Arbor: unable to list refs for the graph sidebar',
        e instanceof Error ? e : undefined
      )
    }
  }

  private matches(name: string) {
    const filter = this.state.filter.trim().toLowerCase()
    return filter.length === 0 || name.toLowerCase().includes(filter)
  }

  private onFilterChanged = (filter: string) => this.setState({ filter })

  private onRefClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const name = event.currentTarget.dataset.ref
    if (name !== undefined) {
      this.props.onSelectRef(name)
    }
  }

  private onLocalDoubleClick = async (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const branch = this.state.local.find(
      b => b.name === event.currentTarget.dataset.ref
    )
    if (branch !== undefined && branch.name !== this.state.current) {
      await this.props.dispatcher.checkoutBranch(this.props.repository, branch)
      this.load()
    }
  }

  private onToggleSection = (event: React.MouseEvent<HTMLButtonElement>) => {
    const section = event.currentTarget.dataset.section
    if (section === undefined) {
      return
    }
    this.setState(state => {
      const collapsed = new Set(state.collapsed)
      if (!collapsed.delete(section)) {
        collapsed.add(section)
      }
      return { collapsed }
    })
  }

  private renderSection(
    id: string,
    title: string,
    icon: typeof octicons.tag,
    items: ReadonlyArray<{ name: string; label: string; current?: boolean }>,
    onDoubleClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  ) {
    const visible = items.filter(i => this.matches(i.label))
    const collapsed = this.state.collapsed.has(id)

    return (
      <section className="arbor-graph-sidebar-section" key={id}>
        <button
          type="button"
          className="arbor-graph-sidebar-title"
          data-section={id}
          onClick={this.onToggleSection}
          aria-expanded={!collapsed}
        >
          <Octicon
            symbol={collapsed ? octicons.chevronRight : octicons.chevronDown}
          />
          {title}
          <span className="count">{visible.length}</span>
        </button>
        {!collapsed && (
          <ul>
            {visible.map(i => (
              <li key={i.name}>
                <button
                  type="button"
                  className={`arbor-graph-sidebar-ref${
                    i.current ? ' current' : ''
                  }`}
                  data-ref={i.name}
                  onClick={this.onRefClick}
                  onDoubleClick={onDoubleClick}
                >
                  <Octicon symbol={i.current ? octicons.check : icon} />
                  <span className="name">{i.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  public render() {
    const { local, remotes, tags, current } = this.state

    return (
      <div className="arbor-graph-sidebar">
        <TextBox
          className="arbor-graph-sidebar-filter"
          placeholder="Filter branches and tags"
          value={this.state.filter}
          onValueChanged={this.onFilterChanged}
          ariaLabel="Filter branches and tags"
        />
        <div className="arbor-graph-sidebar-lists">
          {this.renderSection(
            'local',
            'Local',
            octicons.gitBranch,
            local.map(b => ({
              name: b.name,
              label: b.name,
              current: b.name === current,
            })),
            this.onLocalDoubleClick
          )}
          {[...remotes].map(([remote, branches]) =>
            this.renderSection(
              `remote:${remote}`,
              remote,
              octicons.globe,
              branches.map(b => ({
                name: b.name,
                label: b.name.substring(remote.length + 1),
              }))
            )
          )}
          {this.renderSection(
            'tags',
            'Tags',
            octicons.tag,
            tags.map(t => ({ name: t, label: t }))
          )}
        </div>
      </div>
    )
  }
}
