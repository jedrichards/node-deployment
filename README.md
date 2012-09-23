
## Node Reverse Proxy Deployment Via Gitolite, Upstart and Monit

This repo represents an attempt to detail an approach for automated deployment and hosting of Node applications on a remote server. I'll try to add step-by-step instructions to this readme file and where relevant commit some example scripts and config files too.

In order to kill two birds with one stone the example Node app we'll be deploying will be a reverse proxy listening on port 80, which will be useful in future when we want to run further services on the server on ports other than 80 but still reach them on clean URIs (i.e. `www.myapp.com` as opposed to `www.myserver.com:8000` etc.)

### Overview

- Node application code is source controlled under Git.
- The remote server is running [Gitolite](https://github.com/sitaramc/gitolite) to enable collaborative development and deployment with multi-user access control to a remote Git repo.
- When new code is pushed to Gitolite a `post-receive` hook is used to execute a shell script which moves the Node application files to their proper location on the server.
- [Upstart](http://upstart.ubuntu.com) and [Monit](http://mmonit.com/monit) are used to manage the Node application on the server for restarting on deployment or server reboot and displaying and reporting status.
- Gitolite runs under a `git` user, and Node apps will run under a `node` user.

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

Setting up [Gitolite](https://github.com/sitaramc/gitolite) on the server is optional, but it makes it much easier to grant granular read/write access to your remote repo to coworkers. If you're pretty sure you're the only person who'll ever be working with the app then you could probably get away with setting up a bare Git repo yourself and working with it directly over SSH. You could possibly use GitHub too, but that's out of the question if you're hosting sensitive/private code and you don't want to pay for private repos.

Setting up Gitolite is beyond the scope of this document, but there's fairly good documentation [here](http://sitaramc.github.com/gitolite/master-toc.html). Suffice to say I encountered a fair few hiccups while getting Gitolite to work, mainly revolving around SSH configuration, so I'm going to briefly talk about some of those sticking points and their remedies.

During installation Gitolite mandates the creation of a `git` (or `gitolite`) user on your server with limited privileges, and when you push code to Gitolite you do so over SSH and authenticate via public key. Gitolite works out whether you have access rights to the repo you're trying to push to by checking the public key you offer to the server, so needless to say it's important that SSH is presenting the correct one. I found the following command useful to verbosely debug a SSH connection that is mysteriously failing:
	
	ssh -vT git@gitolite-host

It can also be useful to nail down which SSH credentials your system may be trying to use for a given user/host combination, in which case you could add an entry to your `~/.ssh/config` file something like this:

	Host gitolite-host
		HostName 0.0.0.0
		IdentityFile ~/.ssh/id_rsa
		User git
		IdentitiesOnly yes

This example would define a `gitolite-host` server alias pointing to the host at IP `0.0.0.0` which would always connect as the remote user `git` using the `~/.ssh/id_rsa` key. The `IdentitiesOnly yes` enforces the use of the specified key, since in some cases the system may give up connecting before the correct key has been used.

What's more OSX will sometimes cache a public key, especially when you've opted to save a key's password to the keychain/`ssh-agent`. So if you're really having trouble SSHing into Gitolite with right user/key combo you can purge that cache like so:

	sudo ssh-add -L # Lists all public keys currently being cached
	sudo ssh-add -D # Deletes all cached public keys

Furthermore, it may be useful to present two different identities to Gitolite. One identity could be the Gitolite admin user which has the rights to the `gitolite-admin` repo, and the other could be your regular user identity which you use for your general coding work. Under these conditions you can add two server aliases to your SSH config which point to the same host but present two different keys:

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

I've added the Node reverse proxy application to this repo so you can look around the files. It uses nodejitsu's [node-http-proxy](https://github.com/nodejitsu/node-http-proxy) under the hood.

Writing a Node application and using `npm` etc. is beyond the scope of this document so I'm not going to go into too any detail, but I'll mention the salient points.

The app reads in a JSON file specifying a set of proxy rules. Traffic hitting the proxy app on port 80 is internally routed to services running on other ports based on the incoming domain name in the request headers. For example, Apache could be set to listen on port 8000, and another Node app could be listening on port 8001. Any virtual hosts configured in Apache will continue to work as expected, and what's more since this is Node web sockets and arbitrary TCP/IP traffic will be proxied flawlessly. As I understand it at the time of writing (Sept 2012) nginx and Apache via `mod_proxy` still do not happily support web socket proxying out of the box.

The app is configured for server vs. dev environments via the environment variables `NODE_ENV` and `PORT`. Later on in this document you'll see the environment variables being set in the Upstart job configuration.

The app exposes a special route `/ping` via custom middleware which we'll later see Monit use to check the health of the proxy.

On the server we don't want the app to run as root via `sudo` however we're not allowed to bind to port 80 unless this is the case. One rememdy would be to use ip tables to route all port 80 traffic to a higher port and set our app to listen there. That sounds like extra easily forgotten configuration steps though, so in this case we'll be invoking our app as root initially but then immediately having it downgrade itself to the non-privileged user `node` once internal setup has completed.

### 3. The post-recieve hook

At this stage I'll assume you have some application code added to a fully working remote Gitolite repo on the server and are able to push and pull to it with ease from your workstation.

The task of the Git `post-receive` hook is to invoke a generic deploy script which moves the Node app files out of the bare Gitolite repo and into whichever location we decide to store our active node apps on the server whenever new code is pushed. First you need to SSH into the server and become Gitolite's `git` user:

	ssh user@host
	sudo su git

Navigate to the hooks folder for the relevant repo and start to edit the `post-receive` file. It's important that this file is owned by and executable by the `git` user.

	cd /home/git/repositories/proxy-node-app.git/hooks
	nano post-receive

Make the contents look like (or similar to) the [example post-receive hook](https://github.com/jedrichards/node-deployment/blob/master/post-receive) in this repo.

Here we're attempting to invoke the `/usr/local/sbin/node-deploy` generic deployment script via the `sh` command via `sudo` while passing down a configuration environment variable called `APP_NAME` (we'll go on to make that script in the next section). Since this `post-receive` hook will not be executing in an interactive shell it will bork at the `git` user's attempt to `sudo`, so the next thing we need to do is give the `git` user the right to invoke `/usr/local/sbin/node-deploy` with the `sh` command without a password.

Start to edit the `/etc/sudoers` file:

	sudo visudo

And add the following line at the bottom:

	git ALL = (root) NOPASSWD: /bin/sh /usr/local/sbin/node-deploy

This isn't as big a security concern as it might seem because we're only giving the `git` user password-less `sudo` rights to this one particular script, which itself will only be editable and viewable by `root`.

We're not quite done with `/etc/sudoers` though, we need to stop `sudo` stripping out our `APP_NAME` environment variable. Add the following at the top just above the `Defaults env_reset` line:

	Defaults env_keep += "APP_NAME"

Again, this shouldn't be too much of a security concern because we'll be handling the contents of `APP_NAME` carefully in `node-deploy`.

Save and exit `/etc/sudoers`. We now should be in a postion where we can push to our Gitolite repo and have the `post-receive` execute, and having granted the `git` user password-less `sudo` rights to run our generic deployment script `node-deploy` will run as `root` with the power to do any kind of filesystem manipulation it likes. Now we need to write that script.

### 4. The generic deployment script

I'm calling this a "generic" deployment script because I'm aiming for it to be useful for publishing any reasonably non-complex Node app. To this end we use the `APP_NAME` value passed in from the `post-receive` hook to tailor the behaviour of the script.

I've been told that `/usr/local/sbin` is a sensible place to put such user generated scripts on Ubuntu so go ahead and create a file called `node-deploy` there. It's important that this file belongs to `root`, because it's being invoked as `root` by the `git` user and will be doing some unilateral heavy lifting.

	cd /usr/local/sbin
	sudo touch node-deploy

An example of this script is in this repo [here](https://github.com/jedrichards/node-deployment/blob/master/node-deploy).

The script above is fairly well commented so I won't go into much detail, but basically this script is simply syncronising the contents of the node app directory (in this case `/var/local/node-apps/proxy-node-app`) with the latest revision of files in the bare Gitolite repo. Once that's been done it's changing the ownership of the files to the `node` user and restarting the app via Upstart.

You don't have to keep your node apps in `/var/local/node-apps/`, anywhere will likely do, but after some research it seemed like a reasonably sensible location.

### 5. Upstart

[Upstart](http://upstart.ubuntu.com) is an event driven daemon which handles the automatic starting of services at boot, as well as optionally respawning them if their associated process dies. Additionally it exposes a handy command line API for manipulating the services with commands like `sudo start servicename`, `sudo stop servicename`, `sudo restart servicename` and `sudo status servicename` etc.

A service can be added to Upstart by placing a valid Upstart job configuration file in the `/etc/init` directory, with configuration files having the naming format `servicename.conf`. It's important to note that the Upstart config files execute as `root` so `sudo` and `su` etc. is not needed.

In the context of a Node app we can use Upstart to daemonize the app into a system service. In other words we can start the app with a command like `sudo start proxy-node-app` and have it run in the background without taking over our shell or quiting when we exit our SSH session. Upstart's `start on`, `stop on` and `respawn` directives allow us to have the app automatically restarted on reboot and when it quits unexpectedly. What's more Upstart's start/stop API provides a useful control point for Monit to hook onto (more on that later).

Upstart is already on your box if you're running Ubuntu 10.04 like me, but if you don't have it I think it's installable via `apt-get`.

An example Upstart job configuration is in this repo [here](https://github.com/jedrichards/node-deployment/blob/master/proxy-node-app.conf), again it's well commented so I won't go into any more detail.

### 6. Monit

[Monit](http://mmonit.com/monit) is a utility for managing and monitoring all sorts of UNIX system resources (processes, web services, files, directories  etc). We'll be using it to monitor the health of our proxy Node app, and indeed any other apps we decide to host on this box.

As mentioned above Upstart will automatically respawn services that bomb unexpectedly. However the system process that Upstart monitors could be alive and well but the underlying Node web app could be frozen and not responding to requests. Therefore a more reliable way of checking on our app's health is to actually make a HTTP request and this is where Monit comes in handy - we can set up Monit in such a way that unless it gets a `HTTP 200 OK` response code back from a request to our app it will alert us and attempt to restart it. This is why we added the special `/ping` route to our app - it's a light weight response that Monit can hit that just returns the text `OK` and a `HTTP 200`.

So just to re-iterate: Upstart restarts the app on system reboot and crashes and provides the start/stop command line API while Monit keeps tabs on its status while it is running and restarts it if it looks unhealthy.

I installed Monit via `apt-get` on Ubuntu 10.04. Everything went more or less smoothly, and most of the information you need is in the docs. One caveat is that although the docs say that after installation all you need to run is `sudo monit` to start everything I found that I also needed to run `sudo monit start all` to get things fully under way. Maybe rebooting would have worked as well.

Monit is configured via the `/etc/monit/monitrc` file, and [here's](https://github.com/jedrichards/node-deployment/blob/master/monitrc) my example. The file is commented but broadly speaking my `monitrc` is doing the following things:

- Checking on the health of the `proy-node-app` via its special `/ping` route.
- Exposes Monit's web-based front end on a specific port and controls access via a username and password.
- Sends me an email via Gmail's SMTP servers when there's an alert.
- Monitors Apache and MySQL too, just for kicks.

Monit also exposes a start/stop command line API to its monitored services via commands like `sudo monit start servicename` etc. By managing your services via Monit's API (as opposed to Upstart's) you generate more verbose and accurate status/alert output from Monit.

### Future thoughts

### References and links



