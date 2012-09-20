
## Node Reverse Proxy Deployment Via Gitolite, Upstart and Monit

This repo represents an attempt to detail an approach for automated deployment of Node applications to a remote server. I'll try to add step-by-step instructions to this readme file and where relevant commit some example scripts and configs too.

In order to kill two birds with one stone the example Node app we'll be deploying will be a reverse proxy listening on port 80, which will be useful in future when we want to run further services on other ports (for example, Apache or more Node apps).

### Deploy flow overview

- Node application code is source controlled under Git.
- The remote server is running [Gitolite](https://github.com/sitaramc/gitolite) to enable collaborative development and deployment with multi-user access control.
- When new code is pushed to Gitolite a `post-receive` hook is used to execute a shell script which moves the Node application files to their proper location on the server.
- [Upstart](http://upstart.ubuntu.com) and [Monit](http://mmonit.com/monit) are used to manage the Node application on the server, i.e. restarting on deployment or server reboot and displaying and reporting status.

### Hardware used

- Server: Linode VPS running Ubuntu 10.04 Lucid
- Workstation: OSX Mountain Lion 10.8.1

### Software used

- Node 0.8.9 (server)
- Node 0.8.6 (workstation)
- Git 1.7.0.4 (server)
- Git 1.7.9.6 (Apple Git-31.1) (workstation)
- Monit 5.0.3 (server)
- Gitolite 3.04-15-gaec8c71 (server)
- Upstart 0.6.5-8 (server)

### 1. Setup Gitolite

Setting up [Gitolite](https://github.com/sitaramc/gitolite) on the server is optional, but it makes it much easier to grant read/write access to your remote Git repo to coworkers. If you're pretty sure you're the only person who'll ever be working with the app then you could probably get away with setting up a bare Git repo yourself and working with it directly over SSH.

Setting up Gitolite is beyond the scope of this document, but there's fairly good documentation [here](http://sitaramc.github.com/gitolite/master-toc.html). Suffice to say I encountered a fair few hiccups while getting Gitolite to work, mainly revolving around SSH configuration. Gitolite mandates the creation of a `git` (or `gitolite`) user on your server with limited privileges, and when you push code to Gitolite you do so over SSH and authenticate via public key.

I found the following command useful to verbosely debug a SSH connection that is mysteriously failing:
	
	ssh -vT git@gitolite-host

Gitolite works out whether you have access rights to the repo you're trying to push to by checking the public key you offer to the server, so needless to say it's important that SSH is presenting the correct one.

It can be useful to nail down which SSH credentials your system may be trying to use for a given user/host combination, in which case you could add an entry to your `~/.ssh/config` file like so:

	Host gitolite-host
		HostName 0.0.0.0
		IdentityFile ~/.ssh/id_rsa
		User git
		IdentitiesOnly yes

This example would define a `gitolite-host` server alias pointing to the host at IP `0.0.0.0` which would always connect as the remote user `git` using the `~/.ssh/id_rsa` key. The `IdentitiesOnly yes` enforces the use of the specified key, since is some cases the system may give up connecting before the correct key has been used.

What's more, OSX will sometimes cache a public key that's been added to the system's keychain and/or `ssh-agent`, especially once a key's password has been cached. So if you're really having trouble SSHing into Gitolite with right user/key you can purge that cache like so:

	sudo ssh-add -D

Furthermore, it may be useful to present two different identities to Gitolite. One identity could be the Gitolite admin user which has the right to read and write to the `gitolite-admin` repo, and the other could be your regular user identity which you use for your general coding work. Under these conditions you can add two hosts to your SSH config which point to the same host but present the two different keys:

	Host gitolite-host-admin
		HostName 0.0.0.0
		IdentityFile ~/.ssh/id_rsa_admin
		User git
		IdentitiesOnly yes

	Host gitolite-host-user
		HostName 0.0.0.0
		IdentityFile ~/.ssh/id_rsa_user
		User git
		IdentitiesOnly yes

Then to clone the admin repo:

	git clone git@gitolite-host-admin:gitolite-admin

And to clone a regular repo for work:

	git clone git@gitolite-host-user:some-project

### 2. The Node Application

At this 