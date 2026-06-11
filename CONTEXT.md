# T3 Code

T3 Code is a local web GUI for coding agents. This glossary captures product language for agent-assisted peer review and repository work.

## Language

**Peer Review**:
Agent-assisted review of open pull requests, where findings stay local until a connected user submits them.
_Avoid_: Code review mode, review inbox feature

**Review Inbox**:
The set of repositories and pull requests currently available for Peer Review. A Review Inbox contains zero or more Review Repositories, and each Review Repository contains zero or more Pull Requests.
_Avoid_: PR dashboard, GitHub inbox

**Review Repository**:
A repository surfaced inside the Review Inbox because it belongs to a connected review account or organization. A Review Repository is grouped by owner and may have open Pull Requests.
_Avoid_: Project, workspace repository

**Pull Request**:
A proposed repository change that can be selected for Peer Review. Use "Pull Request" in product language and "PR" only where space is constrained.
_Avoid_: Merge request, change request

**Hidden Review Item**:
A Review Repository or Pull Request hidden from the visible Review Inbox hierarchy. Hidden Review Items remain recoverable from a contextual Hidden list and do not change state in GitHub.
_Avoid_: Archived repository, dismissed PR

**Pinned Pull Request**:
A Pull Request shortcut shown at the top of the Review Inbox. A Pinned Pull Request remains in its Review Repository context and does not override Hidden Review Item visibility.
_Avoid_: Pinned repo, favorite repository

**Review Provider**:
An external account connection used by Peer Review to sync Review Repositories and submit approved findings as the connected user.
_Avoid_: Source Control Provider, Git remote

**Source Control Provider**:
An external repository host used for source control discovery and clone workflows. This is separate from a Review Provider, even when both refer to the same host.
_Avoid_: Review Provider

**Review Run**:
A single agent execution against a Pull Request. A Review Run produces zero or more Review Findings and may draft a Review Summary plus Review Comment Drafts for user approval.
_Avoid_: Scan, audit

**Review Finding**:
A specific issue, risk, or question identified by a Review Run. A Review Finding is agent analysis; it may draft one or more Review Comment Drafts but is not itself a GitHub comment.
_Avoid_: Comment, annotation

**Review Code Block**:
A stable hunk of Pull Request diff used as context and as an anchor target for inline review comments. Review Code Blocks preserve file path, side, line, range, and PR head SHA context.
_Avoid_: Snippet, code card

**Review Comment Draft**:
An editable inline comment proposed by T3 and anchored to a Review Code Block. A Review Comment Draft remains local until the user submits a GitHub Pull Request Review or explicitly posts an approved card.
_Avoid_: Finding, annotation

**Review Summary**:
An editable Pull Request review body drafted by T3. A Review Summary is submitted as a GitHub Pull Request Review summary, not as a regular PR issue comment.
_Avoid_: PR comment, run summary

**Review Conversation**:
The PR-scoped chat transcript between the user and the review agent. A Review Conversation can include proposed post cards, but those cards remain local until the user edits, retargets, and approves them.
_Avoid_: Session chat, global thread

**Review Skill**:
A review capability that can be included in Review Runs. Review Skills may be built in or installed by the user.
_Avoid_: Plugin, rule pack

**Trusted MCP Connection**:
An MCP connection explicitly allowed to provide context to Review Runs. Trust is a property of the connection for review use, not a blanket approval for every product workflow.
_Avoid_: Tool, integration

## Example Dialogue

Dev: "GitHub is connected in Source Control. Can I run Peer Review now?"

Domain expert: "Only if GitHub is connected as a Review Provider. Source Control Providers help with repository discovery and clone workflows; Review Providers authorize the Review Inbox and posting Review Findings."

Dev: "So the sidebar should show Review Repositories, not Projects?"

Domain expert: "Correct. Projects are local coding workspaces. Review Repositories are remote repositories in the Review Inbox, grouped by owner, with Pull Requests underneath."
