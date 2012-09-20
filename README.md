
## Node Deployment

This repo represents an attempt to detail an approach for automated deployment of Node applications to a remote server. I'll try to step-by-step instructions to this readme file and where relevant commit some example scripts and configs too.

### Deploy flow

- Node application code is source controlled under Git.
- The remote server is running [Gitolite](https://github.com/sitaramc/gitolite) to enable collaborative development and deployment with access control.
- When new code is pushed to Gitolite a `post-receive` hook is used to execute a shell script which moves the Node application files to their proper location on the server.
- [Upstart](http://upstart.ubuntu.com) and [Monit](http://mmonit.com/monit) are used to manage the Node application on the server, i.e. restarting on deployment or server reboot and displaying and reporting about status.

### Hardware used

- Server: Linode VPS running Ubuntu 10.04 Lucid
- Workstation: OSX Mountain Lion 10.8.1

### Software used

- Node 0.8.9 (server)
- Node 0.8.6 (workstation)
- Monit 5.0.3 (server)
- Gitolite 3.04-15-gaec8c71 (server)
- Upstart 0.6.5-8 (server)
- Git 1.7.0.4 (server)
- Git 1.7.9.6 (Apple Git-31.1) (workstation)

### 1. Setup Gitolite

Setting up [Gitolite](https://github.com/sitaramc/gitolite) on the server is optional, but it makes it much easier to grant read/write access to your remote Git repo to trusted other users. If you're pretty sure you're the only person who'll ever be working on and deploying the app then you could probably get away with setting up a bare Git repo yourself and working with it directly over SSH.

Setting up Gitolite is beyond the scope of this document, but there's fairly good documentation [here](http://sitaramc.github.com/gitolite/master-toc.html). Suffice to say I encountered a fair few hiccups while getting Gitolite to work, mainly revolving around SSH and public/private keys and wotnot.

Gitolite mandates the creation of a `git` (or `gitolite`) user on your server with reduced privileges. When you push code to Gitolite you do so over SSH and authenticate via public key. I found the following command useful to verbosely debug a SSH connection and find out at what point it may be failing:
	
	ssh -vT git@gitolite-host

It can be useful to nail down which SSH credentials your system may be trying to use for a particular host and user combination, in which case you could add an entry to your `~/.ssh/config` file:

	Host gitolite-host
		HostName 0.0.0.0
		Port 22
		IdentityFile ~/.ssh/id_rsa
		User git
		IdentitiesOnly yes

The `IdentitiesOnly yes` line is particularly relevant here as the system will sometimes fail a connection before it's even tried to use the correct public key. What's more OSX will sometimes cache a public key that's been added to the system keychain and/or `ssh-agent`. So if you're really having bother you can purge that cache like so:

	sudo ssh-add -D

Hopefully you won't have as much trouble as I did!