
## Node Reverse Proxy Deployment Via Gitolite, Upstart and Monit

This repo represents an attempt to detail an approach for automated deployment of Node applications to a remote server. I'll try to add step-by-step instructions to this readme file and where relevant commit some example scripts and configs too.

In order to kill two birds with one stone the example Node app we'll be deploying will be a reverse proxy listening on port 80, which will be useful in future when we want to run further services on other ports (for example Apache or more Node apps).

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

Setting up Gitolite is beyond the scope of this document, but there's fairly good documentation [here](http://sitaramc.github.com/gitolite/master-toc.html). Suffice to say I encountered a fair few hiccups while getting Gitolite to work, mainly revolving around SSH configuration, so I'm going to briefly talk about some of those sticking points and their remedies.

Gitolite mandates the creation of a `git` (or `gitolite`) user on your server with limited privileges, and when you push code to Gitolite you do so over SSH and authenticate via public key. I found the following command useful to verbosely debug a SSH connection that is mysteriously failing:
	
	ssh -vT git@gitolite-host

Gitolite works out whether you have access rights to the repo you're trying to push to by checking the public key you offer to the server, so needless to say it's important that SSH is presenting the correct one.

It can be useful to nail down which SSH credentials your system may be trying to use for a given user/host combination, in which case you could add an entry to your `~/.ssh/config` file like so:

	Host gitolite-host
		HostName 0.0.0.0
		IdentityFile ~/.ssh/id_rsa
		User git
		IdentitiesOnly yes

This example would define a `gitolite-host` server alias pointing to the host at IP `0.0.0.0` which would always connect as the remote user `git` using the `~/.ssh/id_rsa` key. The `IdentitiesOnly yes` enforces the use of the specified key, since in some cases the system may give up connecting before the correct key has been used.

What's more, OSX will sometimes cache a public key that's been added to the system's keychain and/or `ssh-agent`, especially once you've opted to have OSX remember a key's password. So if you're really having trouble SSHing into Gitolite with right user/key you can purge that cache like so:

	sudo ssh-add -L # Lists all public keys currently being cached
	sudo ssh-add -D # Deletes all cached public keys

Furthermore, it may be useful to present two different identities to Gitolite. One identity could be the Gitolite admin user which has the rights to the `gitolite-admin` repo, and the other could be your regular user identity which you use for your general coding work. Under these conditions you can add two hosts to your SSH config which point to the same host but present two different keys:

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

I've added the Node reverse proxy application to this repo so you can look around the files. It uses nodejitsu's excellent [node-http-proxy](https://github.com/nodejitsu/node-http-proxy) under the hood.

Writing a Node application and using `npm` etc. is beyond the scope of this document so I'm not going to go into too much detail, but I'll mention the salient points.

The app reads in a JSON file specifying a set of proxy rules. Traffic hitting the proxy app on port 80 is internally routed to services running on other ports based on the incoming domain name in the request. For example, Apache could be set to listen on port 8000, and another Node app could be listening on port 8001. Any virtual hosts configured in Apache will continue to work as expected, and what's more since this is Node web sockets and arbitrary TCP/IP traffic will be proxied flawlessly. As I understand it at the time of writing (Sept 2012) nginx and Apache via `mod_proxy` still do not happily support web socket proxying out of the box.

The app is configured for server vs. dev environments via the environment variables `NODE_ENV` and `PORT`. Later on in this document you'll see the environment variables being set in the Upstart job configuration.

The app exposes a special route `/ping` via custom middleware which we'll later see Monit use to check the health of the proxy.

On the server we don't want the app to run as root via `sudo` however we're not allowed to bind to port 80 unless this is the case. One rememdy would be to use ip tables to route all port 80 traffic to a higher port and set our app to listen there. That sounds like extra easily forgotten configuration steps though, so in this case we'll be invoking our app as root via `sudo` initially but then immediately having it downgrade itself to a non-privileged user `node` once internal setup has completed.

### 3. The post-recieve hook

At this stage I'll assume you have the application code added to a fully working remote Gitolite repo on the server and are able to push and pull to it with ease from your workstation.

The task of the Git `post-receive` hook is to invoke a generic deploy script which moves the Node app files out of the bare Gitolite repo and into whichever location we decide to store our active node apps on the server whnever new code is pushed. First you need to SSH into the server and become the `git` user:

	ssh user@host
	sudo su git

Navigate to the hooks folder for the relevant repo and start to edit the `post-receive` file. It's important that this file is owned by and executable by the `git` user.

	cd /home/git/repositories/proxy-node-app.git/hooks
	nano post-receive

Make the contents look like (or similar to) this:

	#!/bin/sh

	APP_NAME="proxy-node-app" sudo sh /usr/local/sbin/node-post-receive

Example in this repo [here](https://github.com/jedrichards/node-deployment/blob/master/post-receive).Here we're attempting to invoke the `/usr/local/sbin/node-post-receive` generic deployment script as root with `sudo` while passing a configuration environment variable called `APP_NAME` (we'll go on to make that script in the next section). Since this `post-receive` hook will not be executing in an interactive shell it will bork at the `git` user's attempt to `sudo`, so the next thing we need to do is give the `git` user the right to invoke `/usr/local/sbin/node-post-receive` with the `sh` command without a password.

Start to edit the `/etc/sudoers` file:

	sudo visudo

And add the following line at the bottom:

	git ALL = (root) NOPASSWD: /bin/sh /usr/local/sbin/node-post-receive

This isn't as big a security concern as it might seem because we're only giving the `git` user password-less `sudo` rights to this one particular script, which itself will only be editable and viewable by `root`.

We're not quite done with `/etc/sudoers` though, we need to stop `sudo` stripping out our `APP_NAME` environment variable. Add the following at the top just above the `Defaults env_reset` line:

	Defaults env_keep += "APP_NAME"

Save and exit `/etc/sudoers`. We now should be in a postion where we can push to our Gitolite repo, have the `post-receive` execute and granted the `git` user password-less `sudo` rights to run our generic deployment script. Now we need to write that script.

### 4. The generic deployment script

I'm calling this a "generic" deployment script because I'm aiming for it to be useful for publishing any reasonably non-complex node app. To this end we use the `APP_NAME` value passed in from the `post-receive` hook to tailor the behavour of the script.

I've been told that `/usr/local/sbin` is a sensible place to put such scripts on Ubuntu so go ahead and create a file called `node-post-receive` there. It's important that this file belongs to root, because it's being invoked as root and doing some heavy lifting.

	cd /usr/local/sbin
	sudo touch node-post-receive

The example file is in this repo [here](https://github.com/jedrichards/node-deployment/blob/master/node-post-receive) but I'll repeat it here:

	#!/bin/sh

	echo Executing post_receive hook for "$APP_NAME"

	mkdir -p /var/local/node-apps/$APP_NAME

	unset GIT_INDEX_FILE
	export GIT_WORK_TREE=/var/local/node-apps/$APP_NAME
	export GIT_DIR=/home/git/repositories/$APP_NAME.git

	echo Moving app files to "$GIT_WORK_TREE" ...
	git checkout -f
	chown -R node:node $GIT_WORK_TREE

	echo Restarting $APP_NAME
	monit restart $APP_NAME

Basically this script is simply syncronising the contents of the node app directory (in this case `/var/local/node-apps/proxy-node-app`) with the latest revision of files in the bare Gitolite repo. Once that's been done it's changing the ownership of the files to the `node` user and restarting the app via Monit.

You don't have to keep your node apps in `/var/local/node-apps/`, but after some research it seemed like a reasonably sensible location.

### 5. Upstart

[Upstart](http://upstart.ubuntu.com) is an event driven daemon which handles the automatic starting of services at boot, as well as restarting them if their associated process dies. In the context of a Node application we can use it to effectively daemonize the app into a system service. In other words we can start the app with a command like `sudo start proxy-node-app` and have it run in the background without taking over our shell or quiting when we exit our SSH session.

Upstart is already on your box if you're running Ubuntu 10.04 like me, but if you don't have it I think it's gettable via `apt-get`.


