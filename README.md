
## Node Deployment

This repo represents an attempt to detail an approach for automated deployment of Node applications to a remote server. I'll try to detail as I can to this readme file and where relevant commit some file examples too.

### Deploy flow

- Node application code is source controlled under Git.
- The remote server is running [Gitolite](https://github.com/sitaramc/gitolite) to enabled collaborative development and deployment.
- When new code pushed to Gitolite a `post-receive` hook is used to execute a shell script which moves the Node application to a prepared folder on the server.
- [Upstart](http://upstart.ubuntu.com) and [Monit](http://mmonit.com/monit) are used to manage the Node application on the server, i.e. restarting on deployment or server reboot and displaying and reporting about status.

### Hardware used

- Server: Linode VPS running Ubuntu 10.04 Lucid
- Workstation: OSX Mountain Lion 10.8

### Software used

- Node 0.8.9
- Monit 5.0.3
- Gitolite 3.04-15-gaec8c71
- Upstart 0.6.5-8
- Git 1.7.0.4